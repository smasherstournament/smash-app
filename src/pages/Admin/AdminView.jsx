import React, { useState, useEffect } from 'react';
import { db, auth } from '../../config/firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, setDoc, updateDoc, addDoc, deleteDoc, onSnapshot, serverTimestamp, query, where, getDocs, writeBatch } from 'firebase/firestore';

// 🔴 Smart function to generate N perfectly unique colors
const generateDynamicColor = (index, totalTeams) => {
  const hue = (index * 360) / totalTeams;
  const saturation = 0.75; 
  const lightness = 0.50;  

  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const color = lightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

export default function AdminView() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [view, setView] = useState('hub'); 
  const [tournaments, setTournaments] = useState([]);
  const [activeTournament, setActiveTournament] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  
  const [tourneyConfig, setTourneyConfig] = useState({ 
    name: '', sets: 3, points: 21, numTeams: 4, numPools: 2, numCourts: 2, tableTops: 2, type: 'round-robin', assignmentMode: 'auto'
  });
  
  const [teamNames, setTeamNames] = useState([]);
  const [teamColors, setTeamColors] = useState([]); 
  const [manualTeams, setManualTeams] = useState({});
  const [manualColors, setManualColors] = useState({}); 

  const [matches, setMatches] = useState([]);
  const [selectedPendingMatch, setSelectedPendingMatch] = useState({});
  const [editingMatch, setEditingMatch] = useState(null);
  const [editForm, setEditForm] = useState({ teamA: '', teamB: '' });
  
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, setUser);
    const unsubTournaments = onSnapshot(collection(db, 'tournaments'), (snapshot) => {
      setTournaments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const unsubMatches = onSnapshot(collection(db, 'matches'), (snapshot) => {
      setMatches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => { unsubAuth(); unsubTournaments(); unsubMatches(); };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setAuthError('');
    } catch (err) {
      setAuthError('Invalid email or password. Please try again.');
    }
  };

  const handleSaveTournament = async () => {
    if (isGenerating) return; 
    setIsGenerating(true);

    const poolsMap = {};
    const finalTeamColors = {}; 
    const effectivePools = tourneyConfig.type === 'knockout' ? 1 : (parseInt(tourneyConfig.numPools) || 2);
    
    for (let i = 0; i < effectivePools; i++) {
      poolsMap[tourneyConfig.type === 'knockout' ? 'Main Bracket' : `Pool ${String.fromCharCode(65 + i)}`] = [];
    }
    
    if (tourneyConfig.type === 'round-robin' && tourneyConfig.assignmentMode === 'manual') {
      Object.keys(manualTeams).forEach(poolName => {
        manualTeams[poolName].forEach((team, idx) => {
          const tName = team || `${poolName} Team ${idx + 1}`;
          poolsMap[poolName].push(tName);
          finalTeamColors[tName] = manualColors[poolName]?.[idx] || '#3B82F6';
        });
      });
    } else {
      teamNames.forEach((team, index) => {
        const poolName = tourneyConfig.type === 'knockout' ? 'Main Bracket' : `Pool ${String.fromCharCode(65 + (index % effectivePools))}`;
        const tName = team || `Team ${index + 1}`;
        poolsMap[poolName].push(tName);
        finalTeamColors[tName] = teamColors[index] || '#3B82F6';
      });
    }

    try {
      const generatedRefCode = Math.floor(100000 + Math.random() * 900000).toString();
      const safeDocId = tourneyConfig.name.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now();
      
      const tourneyData = {
        tournamentName: tourneyConfig.name,
        type: tourneyConfig.type,
        status: 'active',
        rules: { 
          sets: parseInt(tourneyConfig.sets) || 3, 
          points: parseInt(tourneyConfig.points) || 21,
          tableTops: parseInt(tourneyConfig.tableTops) || 2
        },
        pools: poolsMap,
        teamColors: finalTeamColors, 
        numCourts: parseInt(tourneyConfig.numCourts) || 2,
        refereeCode: generatedRefCode,
        allowRefereeCourtManagement: false,
        createdAt: new Date().toISOString()
      };
      
      await setDoc(doc(db, 'tournaments', safeDocId), tourneyData);
      const batch = writeBatch(db);
      
      if (tourneyConfig.type === 'round-robin') {
        Object.entries(poolsMap).forEach(([poolName, teams]) => {
          for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
              const matchRef = doc(collection(db, 'matches'));
              batch.set(matchRef, {
                tournamentId: safeDocId, poolName, teamA: teams[i], teamB: teams[j],
                teamAPoints: 0, teamBPoints: 0, currentSet: 1, completedSets: [],
                status: 'pending', courtName: null, createdAt: serverTimestamp()
              });
            }
          }
        });

        const poolNamesList = Object.keys(poolsMap);
        const tops = parseInt(tourneyConfig.tableTops) || 2;
        const getOrdinal = (n) => {
          const s = ["th", "st", "nd", "rd"];
          const v = n % 100;
          return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };

        // 🔴 FIX: Intelligently label as Final if there are exactly 2 pools and 1 Top advancing
        const isSingleFinal = poolNamesList.length === 2 && tops === 1;

        for (let p = 0; p < poolNamesList.length; p += 2) {
          const pool1 = poolNamesList[p];
          const pool2 = poolNamesList[p + 1];
          
          if (pool1 && pool2) {
            for (let i = 1; i <= tops; i++) {
              const matchRef = doc(collection(db, 'matches'));
              batch.set(matchRef, {
                tournamentId: safeDocId, 
                poolName: isSingleFinal ? 'Final' : 'Knockout - Crossover', 
                teamA: `${getOrdinal(i)} ${pool1}`, 
                teamB: `${getOrdinal(tops - i + 1)} ${pool2}`,
                teamAPoints: 0, teamBPoints: 0, currentSet: 1, completedSets: [],
                status: 'pending', courtName: null, createdAt: serverTimestamp()
              });
            }
          }
        }
      } else if (tourneyConfig.type === 'knockout') {
        const teams = poolsMap['Main Bracket'];
        for (let i = 0; i < teams.length; i += 2) {
          const hasOpponent = !!teams[i+1];
          const matchRef = doc(collection(db, 'matches'));
          batch.set(matchRef, {
            tournamentId: safeDocId, 
            poolName: 'Round 1', 
            teamA: teams[i], 
            teamB: hasOpponent ? teams[i+1] : 'BYE', 
            teamAPoints: 0, teamBPoints: 0, currentSet: 1, completedSets: [],
            status: hasOpponent ? 'pending' : 'completed', 
            winner: hasOpponent ? null : teams[i],
            courtName: null, createdAt: serverTimestamp()
          });
        }
      }
      
      await batch.commit();

      setActiveTournament({ id: safeDocId, ...tourneyData });
      setView('tournament-details');
      setTourneyConfig({ name: '', sets: 3, points: 21, numTeams: 4, numPools: 2, numCourts: 2, tableTops: 2, type: 'round-robin', assignmentMode: 'auto' });
      setManualTeams({});
      setManualColors({});
      setTeamColors([]);
    } catch (error) {
      alert("Failed to save tournament.");
    } finally {
      setIsGenerating(false); 
    }
  };

  const handleDeleteTournament = async (id) => {
    if (window.confirm("PERMANENT DELETE: Are you sure you want to completely erase this tournament and all its matches? (Consider Archiving instead!)")) {
      const q = query(collection(db, 'matches'), where("tournamentId", "==", id));
      const querySnapshot = await getDocs(q);
      const batch = writeBatch(db);
      querySnapshot.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      
      await deleteDoc(doc(db, 'tournaments', id));
      if (activeTournament?.id === id) setView('hub');
    }
  };

  const toggleArchiveTournament = async (id, currentStatus) => {
    const newStatus = currentStatus === 'archived' ? 'active' : 'archived';
    await updateDoc(doc(db, 'tournaments', id), { status: newStatus });
    if (activeTournament?.id === id && newStatus === 'archived') {
      setView('hub'); 
    }
  };

  const assignMatchToCourt = async (courtIndex) => {
    const courtName = `Court ${courtIndex + 1}`;
    const matchIdToAssign = selectedPendingMatch[courtName];
    if (!matchIdToAssign) return alert("Please select a pending match first.");
    await updateDoc(doc(db, 'matches', matchIdToAssign), { status: 'active', courtName: courtName });
    setSelectedPendingMatch(prev => ({...prev, [courtName]: ''}));
  };

  const unassignMatch = async (matchId) => {
    if (window.confirm("Remove this match from the court?")) {
      await updateDoc(doc(db, 'matches', matchId), { status: 'pending', courtName: null, teamAPoints: 0, teamBPoints: 0 });
    }
  };

  const saveEditedMatch = async () => {
    await updateDoc(doc(db, 'matches', editingMatch), { teamA: editForm.teamA, teamB: editForm.teamB });
    setEditingMatch(null);
  };

  const getPoolStandings = (poolName) => {
    const tourneyMatches = activeTournament?.type === 'knockout' 
      ? matches.filter(m => m.tournamentId === activeTournament?.id)
      : matches.filter(m => m.tournamentId === activeTournament?.id && m.poolName === poolName);
    
    let teamNames = activeTournament?.pools[poolName] || [];
    if (teamNames.length === 0) {
      const uniqueTeams = new Set();
      tourneyMatches.forEach(m => {
        if (m.teamA) uniqueTeams.add(m.teamA);
        if (m.teamB && m.teamB !== 'BYE') uniqueTeams.add(m.teamB);
      });
      teamNames = Array.from(uniqueTeams);
    }

    let stats = teamNames.map(t => ({ team: t, won: 0, losses: 0, setsWon: 0, pointsFor: 0, pointsAgainst: 0 }));
    
    const completedMatches = tourneyMatches.filter(m => m.status === 'completed');
    completedMatches.forEach(match => {
      const winnerStat = stats.find(s => s.team === match.winner);
      const loserStat = stats.find(s => s.team !== match.winner && (s.team === match.teamA || s.team === match.teamB) && s.team !== 'BYE');
      
      if (winnerStat) winnerStat.won += 1;
      if (loserStat) loserStat.losses += 1;

      match.completedSets?.forEach(set => {
        const teamAStat = stats.find(s => s.team === match.teamA);
        const teamBStat = stats.find(s => s.team === match.teamB);
        if (teamAStat) {
          if (set.winner === 'A') teamAStat.setsWon += 1;
          teamAStat.pointsFor += set.teamA;
          teamAStat.pointsAgainst += set.teamB;
        }
        if (teamBStat && teamBStat.team !== 'BYE') {
          if (set.winner === 'B') teamBStat.setsWon += 1;
          teamBStat.pointsFor += set.teamB;
          teamBStat.pointsAgainst += set.teamA;
        }
      });
    });

    return stats
      .map(s => ({ ...s, pointDiff: s.pointsFor - s.pointsAgainst }))
      .sort((a, b) => {
        if (b.won !== a.won) return b.won - a.won;       
        if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon; 
        if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
        // 🔴 FIX: Stable sort fallback by team name ensures tables don't randomly reshuffle on live updates
        return a.team.localeCompare(b.team);                
      });
  };

  const handleGenerateNextRound = async () => {
    const tourneyMatches = matches.filter(m => m.tournamentId === activeTournament?.id);
    
    let maxRound = 0;
    tourneyMatches.forEach(m => {
      if (m.poolName.startsWith('Round ')) {
        const r = parseInt(m.poolName.replace('Round ', ''));
        if (r > maxRound) maxRound = r;
      }
      if (m.poolName === 'Final') maxRound = 999;
    });

    if (maxRound === 999) return alert("Tournament is already in the Final phase!");
    if (maxRound === 0) return alert("No active rounds found.");

    const currentRoundMatches = tourneyMatches.filter(m => m.poolName === `Round ${maxRound}`);
    currentRoundMatches.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    const incomplete = currentRoundMatches.filter(m => m.status !== 'completed');
    if (incomplete.length > 0) {
      return alert(`Cannot generate next round! ${incomplete.length} match(es) in Round ${maxRound} are still pending or active.`);
    }

    const advancingTeams = currentRoundMatches.map(m => m.winner);
    if (advancingTeams.length === 1) return alert(`Tournament is complete! ${advancingTeams[0]} is the Champion!`);

    const isFinal = advancingTeams.length === 2;
    const nextRoundName = isFinal ? 'Final' : `Round ${maxRound + 1}`;

    const batch = writeBatch(db);
    for (let i = 0; i < advancingTeams.length; i += 2) {
      const hasOpponent = !!advancingTeams[i+1];
      const matchRef = doc(collection(db, 'matches'));
      batch.set(matchRef, {
        tournamentId: activeTournament.id,
        poolName: nextRoundName,
        teamA: advancingTeams[i],
        teamB: hasOpponent ? advancingTeams[i+1] : 'BYE',
        teamAPoints: 0, teamBPoints: 0, currentSet: 1, completedSets: [],
        status: hasOpponent ? 'pending' : 'completed', 
        winner: hasOpponent ? null : advancingTeams[i],
        courtName: null, createdAt: serverTimestamp()
      });
    }

    await batch.commit();
    alert(`${nextRoundName} has been generated successfully!`);
  };

  // 🔴 FIX: Smart Auto-Resolve that blocks execution if pools aren't completely finished
  const handleAutoResolve = async () => {
    const regex = /^(\d+)(st|nd|rd|th) Pool ([A-Z])$/;
    
    const playoffMatches = matches.filter(m => 
      m.tournamentId === activeTournament?.id && 
      (m.poolName === 'Knockout - Crossover' || m.poolName === 'Final') && 
      m.status === 'pending'
    );

    if (playoffMatches.length === 0) return alert("No pending playoff matches to resolve.");

    const poolsNeeded = new Set();
    playoffMatches.forEach(match => {
      const matchA = match.teamA?.match(regex);
      if (matchA) poolsNeeded.add(`Pool ${matchA[3]}`);
      
      const matchB = match.teamB?.match(regex);
      if (matchB) poolsNeeded.add(`Pool ${matchB[3]}`);
    });

    if (poolsNeeded.size > 0) {
      const tourneyMatches = matches.filter(m => m.tournamentId === activeTournament?.id);
      
      // Enforce strict completion of required pools
      for (const poolName of poolsNeeded) {
        const matchesInPool = tourneyMatches.filter(m => m.poolName === poolName);
        const incompleteMatches = matchesInPool.filter(m => m.status !== 'completed');
        
        if (incompleteMatches.length > 0) {
          return alert(`Cannot resolve yet! [${poolName}] still has ${incompleteMatches.length} unfinished match(es). All matches in the pool must be completed first.`);
        }
      }
    } else {
      return alert("No unresolved placeholders found.");
    }

    if (!window.confirm("All required pools are complete! Auto-resolve bracket?")) return;

    const batch = writeBatch(db);
    const allStandings = {};
    Object.keys(activeTournament.pools).forEach(poolName => {
      allStandings[poolName] = getPoolStandings(poolName);
    });

    playoffMatches.forEach(match => {
      let updatedTeamA = match.teamA;
      let updatedTeamB = match.teamB;

      const matchA = match.teamA.match(regex);
      if (matchA) {
        const rankIndex = parseInt(matchA[1]) - 1;
        const poolName = `Pool ${matchA[3]}`;
        if (allStandings[poolName] && allStandings[poolName][rankIndex]) {
          updatedTeamA = allStandings[poolName][rankIndex].team;
        }
      }

      const matchB = match.teamB.match(regex);
      if (matchB) {
        const rankIndex = parseInt(matchB[1]) - 1;
        const poolName = `Pool ${matchB[3]}`;
        if (allStandings[poolName] && allStandings[poolName][rankIndex]) {
          updatedTeamB = allStandings[poolName][rankIndex].team;
        }
      }

      const matchRef = doc(db, 'matches', match.id);
      batch.update(matchRef, { teamA: updatedTeamA, teamB: updatedTeamB });
    });

    await batch.commit();
    alert("Bracket resolved successfully!");
  };

  const handleCreateFinal = async () => {
    const crossoverMatches = matches.filter(m => m.tournamentId === activeTournament?.id && m.poolName === 'Knockout - Crossover' && m.status === 'completed');
    
    if (crossoverMatches.length !== 2) {
      return alert(`You need exactly 2 completed crossover matches to automatically create a Final. Currently have ${crossoverMatches.length}.`);
    }

    const teamA = crossoverMatches[0].winner;
    const teamB = crossoverMatches[1].winner;

    if (!teamA || !teamB) {
      return alert("One or both crossover matches are missing a winner!");
    }

    const existingFinal = matches.find(m => m.tournamentId === activeTournament?.id && m.poolName === 'Final');
    if (existingFinal) return alert("The Final match has already been generated!");

    if (window.confirm(`Ready to generate the Final match: ${teamA} vs ${teamB}?`)) {
      await addDoc(collection(db, 'matches'), {
        tournamentId: activeTournament.id,
        poolName: 'Final',
        teamA: teamA,
        teamB: teamB,
        teamAPoints: 0,
        teamBPoints: 0,
        currentSet: 1,
        completedSets: [],
        status: 'pending',
        courtName: null,
        createdAt: serverTimestamp()
      });
      alert("Final match added to the Pending Queue!");
    }
  };

  // ==========================================
  // RENDER: LOGIN SCREEN
  // ==========================================
  if (!user) {
    return (
      <div className="p-4 bg-white rounded-xl shadow-sm max-w-sm mx-auto mt-10">
        <h2 className="text-2xl font-bold mb-4 text-center">Admin Login</h2>
        <form onSubmit={handleLogin} className="space-y-4">
          {authError && (
            <div className="bg-red-50 border-l-4 border-red-500 p-3 text-red-700 text-sm font-bold">
              {authError}
            </div>
          )}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border p-2 rounded" required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border p-2 rounded" required />
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg font-bold">Login</button>
        </form>
      </div>
    );
  }

  // ==========================================
  // RENDER: HUB (TOURNAMENT LIST)
  // ==========================================
  if (view === 'hub') {
    const displayTourneys = tournaments.filter(t => showArchived ? t.status === 'archived' : t.status !== 'archived');

    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[70vh]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Tournament Hub</h2>
          <button onClick={() => signOut(auth)} className="text-sm text-red-600 font-medium">Logout</button>
        </div>
        <button onClick={() => setView('wizard-config')} className="w-full mb-6 bg-blue-600 text-white py-3 rounded-lg font-bold shadow-sm">+ Create New Tournament</button>
        
        <div className="flex justify-center mb-4">
          <div className="bg-gray-100 p-1 rounded-lg flex text-sm font-bold w-full max-w-xs">
            <button 
              onClick={() => setShowArchived(false)} 
              className={`flex-1 py-1.5 rounded-md ${!showArchived ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
            >
              Active
            </button>
            <button 
              onClick={() => setShowArchived(true)} 
              className={`flex-1 py-1.5 rounded-md ${showArchived ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
            >
              Archived
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {displayTourneys.length === 0 && (
            <p className="text-center text-gray-500 py-6">No {showArchived ? 'archived' : 'active'} tournaments found.</p>
          )}
          {displayTourneys.map(t => (
            <div key={t.id} className="border p-4 rounded-lg flex justify-between items-center hover:bg-gray-50">
              <div>
                <h4 className="font-bold text-lg">{t.tournamentName || 'Unnamed'}</h4>
                <p className="text-xs text-gray-500 capitalize">{t.type === 'round-robin' ? 'Round Robin' : 'Knockout'}</p>
              </div>
              <div className="flex space-x-2">
                {!showArchived && (
                  <button onClick={() => { setActiveTournament(t); setView('tournament-details'); }} className="bg-gray-800 text-white px-3 py-2 rounded font-medium text-sm">Open</button>
                )}
                <button 
                  onClick={() => toggleArchiveTournament(t.id, t.status)} 
                  className={`px-3 py-2 rounded font-medium text-sm ${showArchived ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}
                >
                  {showArchived ? 'Un-Archive' : 'Archive'}
                </button>
                <button onClick={() => handleDeleteTournament(t.id)} className="bg-red-100 text-red-600 px-3 py-2 rounded font-bold text-sm">X</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: WIZARD
  // ==========================================
  if (view === 'wizard-config' || view === 'wizard-teams') {
    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[70vh]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">
            {view === 'wizard-config' ? 'Tournament Setup' : 'Name the Teams'}
          </h2>
          <button onClick={() => setView('hub')} className="text-sm text-gray-500 font-medium hover:text-gray-800 transition-colors">
            Cancel
          </button>
        </div>

        {view === 'wizard-config' ? (
          <div className="space-y-4">
            <input type="text" placeholder="Tournament Name" value={tourneyConfig.name} onChange={(e) => setTourneyConfig({...tourneyConfig, name: e.target.value})} className="w-full border p-2 rounded text-lg font-bold" />
            <select value={tourneyConfig.type} onChange={(e) => setTourneyConfig({...tourneyConfig, type: e.target.value})} className="w-full border p-2 rounded font-medium bg-gray-50">
              <option value="round-robin">Round Robin (Pools)</option>
              <option value="knockout">Knockout Bracket</option>
            </select>
            
            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div><label className="text-xs font-bold text-gray-500 uppercase">Total Teams</label><input type="number" value={tourneyConfig.numTeams} onChange={(e) => setTourneyConfig({...tourneyConfig, numTeams: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border p-2 rounded mt-1" /></div>
              <div><label className="text-xs font-bold text-gray-500 uppercase">Courts</label><input type="number" value={tourneyConfig.numCourts} onChange={(e) => setTourneyConfig({...tourneyConfig, numCourts: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border p-2 rounded mt-1" /></div>
              
              <div><label className="text-xs font-bold text-gray-500 uppercase">Sets (Best Of)</label><input type="number" min="1" step="2" value={tourneyConfig.sets} onChange={(e) => setTourneyConfig({...tourneyConfig, sets: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border p-2 rounded mt-1" /></div>
              <div><label className="text-xs font-bold text-gray-500 uppercase">Points per Set</label><input type="number" min="1" value={tourneyConfig.points} onChange={(e) => setTourneyConfig({...tourneyConfig, points: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border p-2 rounded mt-1" /></div>
              
              {tourneyConfig.type === 'round-robin' && (
                <div><label className="text-xs font-bold text-gray-500 uppercase">Pools (Even Only)</label><input type="number" min="2" step="2" value={tourneyConfig.numPools} onChange={(e) => setTourneyConfig({...tourneyConfig, numPools: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border p-2 rounded mt-1" /></div>
              )}
              {tourneyConfig.type === 'round-robin' && (
                <div><label className="text-xs font-bold text-blue-600 uppercase">Table Tops</label><input type="number" min="1" value={tourneyConfig.tableTops} onChange={(e) => setTourneyConfig({...tourneyConfig, tableTops: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border-2 border-blue-200 p-2 rounded mt-1" /></div>
              )}
              
              {tourneyConfig.type === 'round-robin' && (
                <div className="col-span-2 mt-2 p-4 bg-blue-50 border-2 border-blue-200 rounded-xl">
                  <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="w-full sm:w-auto text-left">
                      <label className="text-sm font-bold text-blue-900 uppercase">Pool Assignment Mode</label>
                      <p className="text-xs text-blue-700">How do you want to assign teams to pools?</p>
                    </div>
                    
                    <div className="flex bg-white p-1 rounded-lg border border-blue-200 shadow-sm w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setTourneyConfig({...tourneyConfig, assignmentMode: 'auto'})}
                        className={`flex-1 sm:flex-none px-6 py-2 rounded-md font-bold text-sm transition-all ${
                          tourneyConfig.assignmentMode === 'auto' 
                          ? 'bg-blue-600 text-white shadow-md' 
                          : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        ⚡ Auto
                      </button>
                      <button
                        type="button"
                        onClick={() => setTourneyConfig({...tourneyConfig, assignmentMode: 'manual'})}
                        className={`flex-1 sm:flex-none px-6 py-2 rounded-md font-bold text-sm transition-all ${
                          tourneyConfig.assignmentMode === 'manual' 
                          ? 'bg-blue-600 text-white shadow-md' 
                          : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        ✋ Manual
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <button 
              onClick={() => { 
                const totalTeams = parseInt(tourneyConfig.numTeams) || 4;
                let colorIndexCounter = 0; 

                if (tourneyConfig.type === 'round-robin' && tourneyConfig.assignmentMode === 'manual') {
                  const effectivePools = parseInt(tourneyConfig.numPools) || 2;
                  const initialManual = {};
                  const initialManualColors = {};
                  for(let i=0; i<effectivePools; i++) {
                     const poolName = `Pool ${String.fromCharCode(65 + i)}`;
                     let count = Math.floor(totalTeams / effectivePools);
                     if (i < totalTeams % effectivePools) count++; 
                     initialManual[poolName] = Array(count).fill('');
                     
                     initialManualColors[poolName] = Array.from({length: count}).map(() => 
                       generateDynamicColor(colorIndexCounter++, totalTeams)
                     );
                  }
                  setManualTeams(initialManual);
                  setManualColors(initialManualColors);
                } else {
                  setTeamNames(Array(totalTeams).fill('')); 
                  
                  setTeamColors(Array.from({length: totalTeams}).map((_, i) => 
                    generateDynamicColor(i, totalTeams)
                  ));
                }
                setView('wizard-teams'); 
              }} 
              disabled={!tourneyConfig.name || (tourneyConfig.type === 'round-robin' && (!tourneyConfig.numPools || parseInt(tourneyConfig.numPools) % 2 !== 0))} 
              className="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              Next →
            </button>
          </div>
        ) : (
          <div>
            {tourneyConfig.type === 'round-robin' && tourneyConfig.assignmentMode === 'manual' ? (
              <div className="space-y-4 mb-6 max-h-[50vh] overflow-y-auto pr-2">
                {Object.keys(manualTeams).map(poolName => (
                  <div key={poolName} className="border-2 border-gray-100 p-4 rounded-xl bg-gray-50">
                    <h4 className="font-bold text-blue-800 mb-3">{poolName}</h4>
                    <div className="space-y-2">
                      {manualTeams[poolName].map((team, idx) => (
                        <div key={idx} className="flex gap-2">
                          <div 
                            className="w-10 rounded border shadow-sm flex-shrink-0" 
                            style={{ backgroundColor: manualColors[poolName]?.[idx] || '#3B82F6' }}
                            title="Auto-assigned Team Color"
                          />
                          <input 
                            type="text" 
                            value={team} 
                            onChange={(e) => { 
                              const newManual = { ...manualTeams }; 
                              newManual[poolName][idx] = e.target.value; 
                              setManualTeams(newManual); 
                            }} 
                            placeholder={`${poolName} - Team ${idx + 1}`} 
                            className="flex-1 border p-2 rounded shadow-sm focus:border-blue-500 focus:outline-none" 
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3 mb-6 max-h-[50vh] overflow-y-auto">
                {Array.from({ length: parseInt(tourneyConfig.numTeams) || 4 }).map((_, index) => (
                  <div key={index} className="flex gap-2">
                    <div 
                      className="w-10 rounded border shadow-sm flex-shrink-0" 
                      style={{ backgroundColor: teamColors[index] || '#3B82F6' }}
                      title="Auto-assigned Team Color"
                    />
                    <input 
                      type="text" 
                      value={teamNames[index] || ''} 
                      onChange={(e) => { 
                        const newNames = [...teamNames]; 
                        newNames[index] = e.target.value; 
                        setTeamNames(newNames); 
                      }} 
                      placeholder={`Team ${index + 1}`} 
                      className="flex-1 border p-2 rounded shadow-sm focus:border-blue-500 focus:outline-none" 
                    />
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex gap-3">
              <button 
                onClick={() => setView('wizard-config')}
                className="w-1/3 bg-gray-200 text-gray-800 py-3 rounded-lg font-bold hover:bg-gray-300 transition-colors"
              >
                ← Back
              </button>
              <button 
                onClick={handleSaveTournament} 
                disabled={isGenerating}
                className={`w-2/3 text-white py-3 rounded-lg font-bold shadow-md transition-colors ${isGenerating ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
              >
                {isGenerating ? 'Generating...' : 'Generate Tournament'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER: TOURNAMENT DETAILS & SCHEDULER
  // ==========================================
  const liveActiveTournament = tournaments.find(t => t.id === activeTournament?.id) || activeTournament;
  
  const tourneyMatches = matches.filter(m => m.tournamentId === liveActiveTournament?.id);
  const pendingMatches = tourneyMatches.filter(m => m.status === 'pending');
  const activeCourtsMatches = tourneyMatches.filter(m => m.status === 'active');
  const completedMatches = tourneyMatches.filter(m => m.status === 'completed');

  const standardPools = Object.keys(liveActiveTournament?.pools || {});
  const hasCrossovers = tourneyMatches.some(m => m.poolName === 'Knockout - Crossover');
  const hasFinal = tourneyMatches.some(m => m.poolName === 'Final');
  
  const allDisplayPools = [...standardPools];
  if (hasCrossovers) allDisplayPools.push('Knockout - Crossover');
  if (hasFinal) allDisplayPools.push('Final');

  const finalMatch = tourneyMatches.find(m => m.poolName === 'Final' && m.status === 'completed');
  const knockoutChampion = finalMatch ? finalMatch.winner : null;

  // 🔴 FIX: Strict Regex completely blocks assigning unresolved placeholders
  const isMatchResolved = (m) => {
    const regex = /^(\d+)(st|nd|rd|th) Pool ([A-Z])$/;
    return !regex.test(m.teamA) && !regex.test(m.teamB) && m.teamA !== 'BYE' && m.teamB !== 'BYE';
  };
  const assignablePendingMatches = pendingMatches.filter(isMatchResolved);

  return (
    <div className="p-4 bg-white rounded-xl shadow-sm min-h-[70vh]">
      <div className="flex justify-between items-start mb-6 border-b pb-4">
        <div>
          <button onClick={() => setView('hub')} className="text-xs text-blue-600 font-bold uppercase mb-1 hover:underline">← Back to Hub</button>
          <h2 className="text-2xl font-bold text-gray-800">{liveActiveTournament?.tournamentName}</h2>
        </div>
        <div className="text-right bg-blue-50 p-3 rounded-lg border border-blue-100 min-w-[140px]">
          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">Referee Code</p>
          <p className="text-2xl font-mono font-bold tracking-widest text-gray-800">{liveActiveTournament?.refereeCode || 'N/A'}</p>
        </div>
      </div>

      {liveActiveTournament && (
        <div className="mb-8 border-b pb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-gray-500 uppercase">
              {liveActiveTournament.type === 'knockout' ? 'Live Tournament Standings' : 'Live Pool Standings & Playoffs'}
            </h3>
            
            {liveActiveTournament.type === 'round-robin' ? (
              <button onClick={handleAutoResolve} className="bg-purple-600 text-white px-3 py-1 text-xs font-bold rounded shadow-sm hover:bg-purple-700 transition-colors">
                ⚡ Auto-Resolve Knockouts
              </button>
            ) : (
              <button onClick={handleGenerateNextRound} className="bg-purple-600 text-white px-3 py-1 text-xs font-bold rounded shadow-sm hover:bg-purple-700 transition-colors">
                ⚡ Generate Next Round
              </button>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {allDisplayPools.map(poolName => {
              const standings = getPoolStandings(poolName);
              if (standings.length === 0) return null;
              const isKnockout = liveActiveTournament.type === 'knockout';

              return (
                <div key={poolName} className="border rounded-lg overflow-hidden bg-white shadow-sm overflow-x-auto w-full">
                  <div className={`text-white text-xs font-bold px-3 py-2 uppercase ${poolName === 'Final' ? 'bg-yellow-500' : poolName.includes('Knockout') ? 'bg-purple-600' : 'bg-blue-600'}`}>
                    {isKnockout ? "Overall Standings" : poolName}
                  </div>
                  <table className="w-full text-left text-sm min-w-max">
                    <thead className="bg-gray-100 text-gray-600 text-xs uppercase">
                      <tr>
                        <th className="px-3 py-2">Team</th>
                        <th className="px-2 py-2 text-center">W</th>
                        <th className="px-2 py-2 text-center">Sets</th>
                        <th className="px-2 py-2 text-center text-red-500">L</th> 
                        {isKnockout && <th className="px-2 py-2 text-center text-blue-600">Status</th>}
                        <th className="px-2 py-2 text-center" title="Point Differential">Pt Diff</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {standings.map((stat, idx) => {
                        const isChampion = (poolName === 'Final' && idx === 0 && stat.won > 0) || (isKnockout && stat.team === knockoutChampion);
                        const isKnockoutWinner = poolName === 'Knockout - Crossover' && stat.won > 0;
                        const isPoolQualifier = standardPools.includes(poolName) && idx < liveActiveTournament.rules.tableTops;
                        const isEliminated = isKnockout && stat.losses > 0;
                        
                        return (
                          <tr key={stat.team} className={isChampion ? "bg-yellow-100 font-bold" : (isKnockoutWinner || isPoolQualifier) ? "bg-green-50" : ""}>
                            <td className={`px-3 py-2 font-medium flex items-center ${isEliminated ? 'line-through text-gray-400' : ''}`}>
                              <span className="w-3 h-3 rounded-full mr-2 inline-block" style={{ backgroundColor: liveActiveTournament.teamColors?.[stat.team] || '#2563EB' }}></span>
                              {stat.team} {isChampion && " 🏆"}
                            </td>
                            <td className="px-2 py-2 text-center font-bold">{stat.won}</td>
                            <td className="px-2 py-2 text-center text-gray-600">{stat.setsWon}</td>
                            <td className="px-2 py-2 text-center font-bold text-red-500">{stat.losses}</td>
                            
                            {isKnockout && (
                              <td className={`px-2 py-2 text-center font-bold ${isEliminated ? 'text-red-500' : 'text-green-500'}`}>
                                {isEliminated ? 'OUT' : 'IN'}
                              </td>
                            )}

                            <td className={`px-2 py-2 text-center font-bold ${stat.pointDiff > 0 ? 'text-green-600' : stat.pointDiff < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                              {stat.pointDiff > 0 ? `+${stat.pointDiff}` : stat.pointDiff}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --- SMART COURT MANAGER --- */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-gray-500 uppercase">Court Manager</h3>
        
        <label className="flex items-center cursor-pointer">
          <span className="mr-2 text-xs font-bold text-gray-600 uppercase">Referee Assign</span>
          <div className="relative">
            <input 
              type="checkbox" 
              className="sr-only" 
              checked={liveActiveTournament?.allowRefereeCourtManagement || false} 
              onChange={async (e) => {
                await updateDoc(doc(db, 'tournaments', liveActiveTournament.id), { 
                  allowRefereeCourtManagement: e.target.checked 
                });
              }} 
            />
            <div className={`block w-10 h-6 rounded-full transition-colors ${liveActiveTournament?.allowRefereeCourtManagement ? 'bg-green-500' : 'bg-gray-300'}`}></div>
            <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition transform ${liveActiveTournament?.allowRefereeCourtManagement ? 'translate-x-4' : ''}`}></div>
          </div>
        </label>
      </div>
      
      <div className="space-y-3 mb-8">
        {Array.from({ length: liveActiveTournament?.numCourts || 2 }).map((_, i) => {
          const courtName = `Court ${i + 1}`;
          const matchOnCourt = activeCourtsMatches.find(m => m.courtName === courtName);

          return (
            <div key={courtName} className={`p-4 border-2 rounded-lg ${matchOnCourt ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
              <h4 className="font-bold text-gray-800 mb-2">{courtName}</h4>
              
              {matchOnCourt ? (
                <div>
                  <div className="flex justify-between items-center bg-white p-3 rounded border shadow-sm mb-2">
                    <div>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${matchOnCourt.poolName === 'Final' ? 'bg-yellow-100 text-yellow-700' : matchOnCourt.poolName.includes('Round ') || matchOnCourt.poolName.includes('Knockout') ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-600'}`}>
                        {matchOnCourt.poolName}
                      </span>
                      <p className="text-sm font-bold mt-2">{matchOnCourt.teamA} vs {matchOnCourt.teamB}</p>
                    </div>
                  </div>
                  <button onClick={() => unassignMatch(matchOnCourt.id)} className="text-xs text-red-600 font-bold hover:underline">Unassign Court</button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <select value={selectedPendingMatch[courtName] || ''} onChange={(e) => setSelectedPendingMatch(prev => ({...prev, [courtName]: e.target.value}))} className="flex-1 border p-2 rounded text-sm w-full">
                    <option value="">-- Select Pending Match --</option>
                    {assignablePendingMatches.map(m => (
                      <option key={m.id} value={m.id}>[{m.poolName}] {m.teamA} vs {m.teamB}</option>
                    ))}
                  </select>
                  <button onClick={() => assignMatchToCourt(i)} className="bg-blue-600 text-white px-4 py-2 rounded font-bold text-sm w-full sm:w-auto hover:bg-blue-700 transition-colors">Assign</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* --- MATCH QUEUE (PENDING) --- */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-gray-500 uppercase">Pending Matches ({pendingMatches.length})</h3>
        
        {completedMatches.filter(m => m.poolName === 'Knockout - Crossover').length === 2 && !matches.find(m => m.tournamentId === liveActiveTournament?.id && m.poolName === 'Final') && (
          <button onClick={handleCreateFinal} className="bg-yellow-500 text-white px-3 py-1 text-xs font-bold rounded shadow-sm hover:bg-yellow-600 transition-colors">
            🏆 Generate Final Match
          </button>
        )}
      </div>
      
      {editingMatch ? (
        <div className="bg-white p-4 rounded-lg border shadow mb-4">
          <h4 className="font-bold mb-2">Resolve Teams</h4>
          <input type="text" value={editForm.teamA} onChange={e => setEditForm({...editForm, teamA: e.target.value})} className="w-full border p-2 mb-2 rounded focus:border-blue-500 focus:outline-none" placeholder="Team A Name" />
          <input type="text" value={editForm.teamB} onChange={e => setEditForm({...editForm, teamB: e.target.value})} className="w-full border p-2 mb-3 rounded focus:border-blue-500 focus:outline-none" placeholder="Team B Name" />
          <div className="flex gap-2">
            <button onClick={saveEditedMatch} className="bg-green-600 text-white px-4 py-2 rounded font-bold hover:bg-green-700 transition-colors">Save</button>
            <button onClick={() => setEditingMatch(null)} className="bg-gray-200 px-4 py-2 rounded font-bold hover:bg-gray-300 transition-colors">Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="bg-gray-50 p-2 rounded-lg border max-h-48 overflow-y-auto mb-6">
        {pendingMatches.length === 0 && <p className="text-sm text-gray-500 p-2 italic">No matches pending.</p>}
        {pendingMatches.map(m => (
          <div key={m.id} className="text-sm border-b py-2 flex justify-between items-center pr-2">
            <span><strong className={m.poolName === 'Final' ? 'text-yellow-600' : m.poolName.includes('Round ') || m.poolName.includes('Knockout') ? 'text-purple-600' : 'text-blue-600'}>[{m.poolName}]</strong> {m.teamA} vs {m.teamB}</span>
            <button onClick={() => { setEditingMatch(m.id); setEditForm({teamA: m.teamA, teamB: m.teamB}); }} className="text-xs text-blue-600 font-bold hover:underline">Edit</button>
          </div>
        ))}
      </div>

      {/* --- COMPLETED MATCHES --- */}
      <h3 className="text-sm font-bold text-gray-500 uppercase mb-3">Completed Matches ({completedMatches.length})</h3>
      <div className="bg-gray-50 p-2 rounded-lg border max-h-48 overflow-y-auto">
        {completedMatches.length === 0 && <p className="text-sm text-gray-500 p-2 italic">No matches completed yet.</p>}
        {completedMatches.map(m => (
          <div key={m.id} className="text-sm border-b py-2 flex justify-between">
            <span><strong className={m.poolName === 'Final' ? 'text-yellow-600' : m.poolName.includes('Round ') || m.poolName.includes('Knockout') ? 'text-purple-600' : 'text-blue-600'}>[{m.poolName}]</strong> {m.teamA} vs {m.teamB}</span>
            <span className="font-bold text-green-600">Winner: {m.winner || 'Finished'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
