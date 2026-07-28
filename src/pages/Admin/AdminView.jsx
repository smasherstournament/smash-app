import React, { useState, useEffect } from 'react';
import { db, auth } from '../../config/firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, setDoc, updateDoc, addDoc, deleteDoc, onSnapshot, serverTimestamp, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { Trophy, LogOut, Plus, Activity, Settings, Users, CheckCircle, ChevronLeft, Calendar, Crown, Edit2, Trash2, Archive, PlayCircle, ShieldAlert, Zap, Lock, Copy, Check } from 'lucide-react';

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
  const [copied, setCopied] = useState(false); // 🔴 State for Copy Button animation

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
        allowRefereeCustomMatches: false,
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
      <div className="flex items-center justify-center min-h-[85vh] bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-xl border border-gray-100">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-50 p-4 rounded-full">
              <ShieldAlert className="text-blue-600" size={32} />
            </div>
          </div>
          <h2 className="text-3xl font-black mb-6 text-center text-gray-900 tracking-tight">Admin Portal</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            {authError && (
              <div className="bg-red-50 border-l-4 border-red-500 p-3 text-red-700 text-sm font-bold rounded-r">
                {authError}
              </div>
            )}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Email</label>
              <input type="email" placeholder="admin@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border-2 border-gray-200 p-3 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none" required />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Password</label>
              <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border-2 border-gray-200 p-3 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none" required />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-black text-lg transition-colors shadow-md mt-4">Login Securely</button>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: HUB (TOURNAMENT LIST)
  // ==========================================
  if (view === 'hub') {
    const displayTourneys = tournaments.filter(t => showArchived ? t.status === 'archived' : t.status !== 'archived');

    return (
      <div className="p-4 md:p-8 bg-gray-50 min-h-[85vh] rounded-2xl">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">Tournament Hub</h2>
          <button onClick={() => signOut(auth)} className="flex items-center text-sm text-red-500 font-bold hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">
            <LogOut size={16} className="mr-2" /> Logout
          </button>
        </div>
        
        <button 
          onClick={() => setView('wizard-config')} 
          className="w-full mb-8 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg flex items-center justify-center transition-all transform hover:-translate-y-1"
        >
          <Plus className="mr-2" /> Create New Tournament
        </button>
        
        <div className="flex justify-center mb-8">
          <div className="bg-gray-200/60 p-1 rounded-xl flex text-sm font-bold w-full max-w-sm shadow-inner">
            <button onClick={() => setShowArchived(false)} className={`flex-1 py-2 rounded-lg transition-all ${!showArchived ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Active Tourneys</button>
            <button onClick={() => setShowArchived(true)} className={`flex-1 py-2 rounded-lg transition-all ${showArchived ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Archived</button>
          </div>
        </div>

        <div className="space-y-4">
          {displayTourneys.length === 0 && (
            <div className="text-center p-12 bg-white rounded-3xl border border-gray-100 shadow-sm">
              <Archive className="mx-auto text-gray-300 mb-4" size={48} />
              <p className="text-gray-500 font-bold">No {showArchived ? 'archived' : 'active'} tournaments found.</p>
            </div>
          )}
          {displayTourneys.map(t => (
            <div key={t.id} className="bg-white border border-gray-100 p-5 rounded-2xl shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h4 className="font-black text-xl text-gray-900 mb-1">{t.tournamentName || 'Unnamed'}</h4>
                <div className="flex items-center text-xs font-bold text-gray-500 uppercase tracking-wider">
                  <Activity size={14} className="mr-1.5 text-blue-500" />
                  {t.type === 'round-robin' ? 'Round Robin' : 'Knockout'}
                  <span className="mx-2">•</span>
                  <Users size={14} className="mr-1.5 text-blue-500" />
                  {Object.values(t.pools || {}).flat().length} Teams
                </div>
              </div>
              
              <div className="flex flex-wrap w-full md:w-auto gap-2">
                {!showArchived && (
                  <button onClick={() => { setActiveTournament(t); setView('tournament-details'); }} className="flex-1 md:flex-none bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-600 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors flex justify-center items-center">
                    <Settings size={16} className="mr-2" /> Manage
                  </button>
                )}
                <button onClick={() => toggleArchiveTournament(t.id, t.status)} className={`flex-1 md:flex-none px-4 py-2.5 rounded-xl font-bold text-sm transition-colors flex justify-center items-center ${showArchived ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-orange-50 text-orange-600 hover:bg-orange-100'}`}>
                  <Archive size={16} className="mr-2" /> {showArchived ? 'Un-Archive' : 'Archive'}
                </button>
                <button onClick={() => handleDeleteTournament(t.id)} className="flex-none bg-red-50 hover:bg-red-600 hover:text-white text-red-500 px-4 py-2.5 rounded-xl font-bold transition-colors">
                  <Trash2 size={16} />
                </button>
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
      <div className="p-4 md:p-8 bg-gray-50 min-h-[85vh] rounded-2xl">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">
            {view === 'wizard-config' ? 'Tournament Setup' : 'Configure Teams'}
          </h2>
          <button onClick={() => setView('hub')} className="text-xs font-bold text-gray-500 uppercase hover:text-gray-900 transition-colors flex items-center">
            Cancel Setup
          </button>
        </div>

        {view === 'wizard-config' ? (
          <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
            
            <div>
              <label className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2 block">Tournament Title</label>
              <input type="text" placeholder="e.g. Summer Smash 2024" value={tourneyConfig.name} onChange={(e) => setTourneyConfig({...tourneyConfig, name: e.target.value})} className="w-full border-2 border-gray-200 p-4 rounded-xl text-xl font-bold focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
              <div className="bg-blue-50/50 p-5 rounded-2xl border border-blue-100">
                <h3 className="font-bold text-blue-900 mb-4 flex items-center"><Settings size={18} className="mr-2 text-blue-600" /> Format Rules</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Bracket Type</label>
                    <select value={tourneyConfig.type} onChange={(e) => setTourneyConfig({...tourneyConfig, type: e.target.value})} className="w-full border-2 border-white bg-white p-3 rounded-xl font-bold text-gray-800 shadow-sm focus:border-blue-400 outline-none">
                      <option value="round-robin">Round Robin (Pools)</option>
                      <option value="knockout">Knockout Bracket</option>
                    </select>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1"><label className="text-xs font-bold text-gray-500 uppercase block mb-1">Sets (Best of)</label><input type="number" min="1" step="2" value={tourneyConfig.sets} onChange={(e) => setTourneyConfig({...tourneyConfig, sets: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border-2 border-white bg-white p-3 rounded-xl font-bold shadow-sm outline-none focus:border-blue-400" /></div>
                    <div className="flex-1"><label className="text-xs font-bold text-gray-500 uppercase block mb-1">Points per set</label><input type="number" min="1" value={tourneyConfig.points} onChange={(e) => setTourneyConfig({...tourneyConfig, points: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border-2 border-white bg-white p-3 rounded-xl font-bold shadow-sm outline-none focus:border-blue-400" /></div>
                  </div>
                </div>
              </div>

              <div className="bg-purple-50/50 p-5 rounded-2xl border border-purple-100">
                <h3 className="font-bold text-purple-900 mb-4 flex items-center"><Users size={18} className="mr-2 text-purple-600" /> Scale & Size</h3>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-1"><label className="text-xs font-bold text-gray-500 uppercase block mb-1">Total Teams</label><input type="number" value={tourneyConfig.numTeams} onChange={(e) => setTourneyConfig({...tourneyConfig, numTeams: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border-2 border-white bg-white p-3 rounded-xl font-bold shadow-sm outline-none focus:border-purple-400" /></div>
                    <div className="flex-1"><label className="text-xs font-bold text-gray-500 uppercase block mb-1">Total Courts</label><input type="number" value={tourneyConfig.numCourts} onChange={(e) => setTourneyConfig({...tourneyConfig, numCourts: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border-2 border-white bg-white p-3 rounded-xl font-bold shadow-sm outline-none focus:border-purple-400" /></div>
                  </div>
                  {tourneyConfig.type === 'round-robin' && (
                    <div className="flex gap-4">
                      <div className="flex-1"><label className="text-xs font-bold text-gray-500 uppercase block mb-1">Pools (Even Only)</label><input type="number" min="2" step="2" value={tourneyConfig.numPools} onChange={(e) => setTourneyConfig({...tourneyConfig, numPools: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border-2 border-white bg-white p-3 rounded-xl font-bold shadow-sm outline-none focus:border-purple-400" /></div>
                      <div className="flex-1"><label className="text-xs font-bold text-purple-600 uppercase block mb-1">Table Tops Adv.</label><input type="number" min="1" value={tourneyConfig.tableTops} onChange={(e) => setTourneyConfig({...tourneyConfig, tableTops: e.target.value === '' ? '' : parseInt(e.target.value)})} className="w-full border-2 border-purple-200 bg-white p-3 rounded-xl font-bold shadow-sm outline-none focus:border-purple-400" /></div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {tourneyConfig.type === 'round-robin' && (
              <div className="p-5 bg-gray-50 rounded-2xl border border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                  <h4 className="font-black text-gray-800 uppercase tracking-widest text-sm">Pool Assignment</h4>
                  <p className="text-xs text-gray-500 font-medium">How should teams be sorted into pools?</p>
                </div>
                <div className="flex bg-gray-200/60 p-1 rounded-xl w-full sm:w-auto shadow-inner">
                  <button type="button" onClick={() => setTourneyConfig({...tourneyConfig, assignmentMode: 'auto'})} className={`flex-1 sm:flex-none px-6 py-2 rounded-lg font-bold text-sm transition-all ${tourneyConfig.assignmentMode === 'auto' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>⚡ Auto Fill</button>
                  <button type="button" onClick={() => setTourneyConfig({...tourneyConfig, assignmentMode: 'manual'})} className={`flex-1 sm:flex-none px-6 py-2 rounded-lg font-bold text-sm transition-all ${tourneyConfig.assignmentMode === 'manual' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>✋ Manual</button>
                </div>
              </div>
            )}
            
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
                     initialManualColors[poolName] = Array.from({length: count}).map(() => generateDynamicColor(colorIndexCounter++, totalTeams));
                  }
                  setManualTeams(initialManual);
                  setManualColors(initialManualColors);
                } else {
                  setTeamNames(Array(totalTeams).fill('')); 
                  setTeamColors(Array.from({length: totalTeams}).map((_, i) => generateDynamicColor(i, totalTeams)));
                }
                setView('wizard-teams'); 
              }} 
              disabled={!tourneyConfig.name || (tourneyConfig.type === 'round-robin' && (!tourneyConfig.numPools || parseInt(tourneyConfig.numPools) % 2 !== 0))} 
              className="w-full mt-6 bg-gray-900 text-white py-4 rounded-xl font-black text-lg hover:bg-black disabled:opacity-50 transition-colors shadow-md"
            >
              Next: Configure Teams →
            </button>
          </div>
        ) : (
          <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-gray-100">
            {tourneyConfig.type === 'round-robin' && tourneyConfig.assignmentMode === 'manual' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                {Object.keys(manualTeams).map(poolName => (
                  <div key={poolName} className="border border-gray-100 p-5 rounded-2xl bg-gray-50">
                    <h4 className="font-black text-blue-800 mb-4 uppercase tracking-widest text-sm">{poolName}</h4>
                    <div className="space-y-3">
                      {manualTeams[poolName].map((team, idx) => (
                        <div key={idx} className="flex gap-3 items-center bg-white p-2 rounded-xl shadow-sm border border-gray-100">
                          <div className="w-8 h-8 rounded-full shadow-inner flex-shrink-0" style={{ backgroundColor: manualColors[poolName]?.[idx] || '#3B82F6' }} title="Team Color" />
                          <input type="text" value={team} onChange={(e) => { const newManual = { ...manualTeams }; newManual[poolName][idx] = e.target.value; setManualTeams(newManual); }} placeholder={`${poolName} - Team ${idx + 1}`} className="flex-1 p-2 bg-transparent font-bold focus:outline-none focus:text-blue-600" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                {Array.from({ length: parseInt(tourneyConfig.numTeams) || 4 }).map((_, index) => (
                  <div key={index} className="flex gap-3 items-center bg-gray-50 p-2 rounded-xl border border-gray-100">
                    <div className="w-8 h-8 rounded-full shadow-inner flex-shrink-0" style={{ backgroundColor: teamColors[index] || '#3B82F6' }} title="Team Color" />
                    <input type="text" value={teamNames[index] || ''} onChange={(e) => { const newNames = [...teamNames]; newNames[index] = e.target.value; setTeamNames(newNames); }} placeholder={`Team ${index + 1}`} className="flex-1 p-2 bg-transparent font-bold focus:outline-none focus:text-blue-600" />
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-gray-100">
              <button onClick={() => setView('wizard-config')} className="sm:w-1/3 bg-gray-100 text-gray-600 py-4 rounded-xl font-black hover:bg-gray-200 transition-colors flex justify-center items-center">
                <ChevronLeft className="mr-1" /> Back
              </button>
              <button onClick={handleSaveTournament} disabled={isGenerating} className={`sm:w-2/3 text-white py-4 rounded-xl font-black text-lg shadow-md transition-all flex justify-center items-center ${isGenerating ? 'bg-gray-400' : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 hover:shadow-lg'}`}>
                {isGenerating ? 'Generating Matches...' : <><PlayCircle className="mr-2" /> Start Tournament Now</>}
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
  const allMatchPools = Array.from(new Set(tourneyMatches.map(m => m.poolName)));
  const customPools = allMatchPools.filter(p => !standardPools.includes(p) && p !== 'Knockout - Crossover' && p !== 'Final' && !p.startsWith('Round '));

  const allDisplayPools = [...standardPools, ...customPools];
  const hasCrossovers = tourneyMatches.some(m => m.poolName === 'Knockout - Crossover');
  const hasFinal = tourneyMatches.some(m => m.poolName === 'Final');
  if (hasCrossovers) allDisplayPools.push('Knockout - Crossover');
  if (hasFinal) allDisplayPools.push('Final');

  const finalMatch = tourneyMatches.find(m => m.poolName === 'Final' && m.status === 'completed');
  const knockoutChampion = finalMatch ? finalMatch.winner : null;

  const isMatchResolved = (m) => {
    const regex = /^(\d+)(st|nd|rd|th) Pool ([A-Z])$/;
    return !regex.test(m.teamA) && !regex.test(m.teamB) && m.teamA !== 'BYE' && m.teamB !== 'BYE';
  };
  const assignablePendingMatches = pendingMatches.filter(isMatchResolved);

  return (
    <div className="p-4 md:p-8 bg-gray-50 min-h-[85vh] rounded-2xl pb-20">
      
      {/* 🔴 HEADER & REFEREE CODE */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <div>
          <button onClick={() => setView('hub')} className="flex items-center text-xs font-black text-gray-500 mb-2 uppercase tracking-widest hover:text-blue-600 transition-colors">
            <ChevronLeft size={16} className="mr-1" /> Tournament Hub
          </button>
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">{liveActiveTournament?.tournamentName}</h2>
        </div>
        <div className="text-right bg-gradient-to-br from-gray-900 to-gray-800 p-4 rounded-2xl border border-gray-700 min-w-[180px] shadow-lg flex flex-col items-center md:items-end">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center">
            <Lock size={12} className="mr-1"/> Referee Code
          </p>
          <div className="flex items-center gap-3">
            <p className="text-3xl font-mono font-bold tracking-[0.2em] text-white">
              {liveActiveTournament?.refereeCode || 'N/A'}
            </p>
            {liveActiveTournament?.refereeCode && (
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(liveActiveTournament.refereeCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className={`p-2 rounded-xl border transition-all active:scale-95 flex items-center justify-center ${
                  copied 
                    ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                    : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
                title="Copy Referee Code"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {liveActiveTournament && (
        <div className="mb-12">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div className="flex items-center">
              <div className="bg-blue-100 p-2 rounded-lg mr-3"><Trophy size={20} className="text-blue-600" /></div>
              <h3 className="text-xl font-black text-gray-800 uppercase tracking-wide">
                {liveActiveTournament.type === 'knockout' ? 'Live Bracket' : 'Live Pools & Playoffs'}
              </h3>
            </div>
            
            {liveActiveTournament.type === 'round-robin' ? (
              <button onClick={handleAutoResolve} className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 text-sm font-bold rounded-xl shadow-md transition-colors flex items-center">
                <Zap size={16} className="mr-2" /> Auto-Resolve Knockouts
              </button>
            ) : (
              <button onClick={handleGenerateNextRound} className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 text-sm font-bold rounded-xl shadow-md transition-colors flex items-center">
                <Zap size={16} className="mr-2" /> Generate Next Round
              </button>
            )}
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {allDisplayPools.map(poolName => {
              const standings = getPoolStandings(poolName);
              if (standings.length === 0) return null;
              const isKnockout = liveActiveTournament.type === 'knockout';

              let headerBg = 'bg-blue-600';
              if (poolName === 'Final') headerBg = 'bg-yellow-500';
              else if (poolName.includes('Knockout') || poolName.includes('Round')) headerBg = 'bg-purple-600';
              else if (customPools.includes(poolName)) headerBg = 'bg-pink-600';

              return (
                <div key={poolName} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                  <div className={`${headerBg} text-white text-xs font-black px-4 py-3 uppercase tracking-widest flex justify-between items-center`}>
                    <span>{isKnockout ? "Overall Standings" : poolName}</span>
                    {customPools.includes(poolName) && <span className="bg-white bg-opacity-20 px-2 py-0.5 rounded text-[10px]">Custom</span>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3 font-bold">Team</th>
                          <th className="px-3 py-3 text-center font-bold">W</th>
                          <th className="px-3 py-3 text-center font-bold">Sets</th>
                          <th className="px-3 py-3 text-center font-bold text-red-400">L</th> 
                          {isKnockout && <th className="px-3 py-3 text-center font-bold text-blue-500">Status</th>}
                          <th className="px-4 py-3 text-center font-bold">Pt Diff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {standings.map((stat, idx) => {
                          const isWinner = (poolName === 'Final' && idx === 0 && stat.won > 0) || (isKnockout && stat.team === knockoutChampion);
                          const isKnockoutWinner = poolName === 'Knockout - Crossover' && stat.won > 0;
                          const isPoolQualifier = standardPools.includes(poolName) && idx < liveActiveTournament.rules.tableTops;
                          const isEliminated = isKnockout && stat.losses > 0;
                          
                          return (
                            <tr key={stat.team} className={`transition-colors hover:bg-gray-50 ${isWinner ? "bg-yellow-50/50" : (isKnockoutWinner || isPoolQualifier) ? "bg-green-50/30" : ""}`}>
                              <td className={`px-4 py-3 font-bold flex items-center ${isEliminated ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                <span className="w-3 h-3 rounded-full mr-3 shadow-inner" style={{ backgroundColor: liveActiveTournament.teamColors?.[stat.team] || '#2563EB' }}></span>
                                {stat.team} 
                                {isWinner && <Crown size={14} className="ml-2 text-yellow-500" />}
                              </td>
                              <td className="px-3 py-3 text-center font-black text-gray-900">{stat.won}</td>
                              <td className="px-3 py-3 text-center font-semibold text-gray-500">{stat.setsWon}</td>
                              <td className="px-3 py-3 text-center font-black text-red-500">{stat.losses}</td>
                              {isKnockout && <td className={`px-3 py-3 text-center font-bold text-xs ${isEliminated ? 'text-red-400' : 'text-green-500'}`}>{isEliminated ? 'OUT' : 'IN'}</td>}
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-block px-2 py-1 rounded-md text-[10px] font-black ${stat.pointDiff > 0 ? 'bg-green-100 text-green-700' : stat.pointDiff < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {stat.pointDiff > 0 ? `+${stat.pointDiff}` : stat.pointDiff}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 🔴 SMART COURT MANAGER */}
      <div className="mb-12">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div className="flex items-center">
            <div className="bg-blue-100 p-2 rounded-lg mr-3"><Calendar size={20} className="text-blue-600" /></div>
            <h3 className="text-xl font-black text-gray-800 uppercase tracking-wide">Court Manager</h3>
          </div>
          
          <div className="flex flex-wrap items-center gap-4 bg-white p-2 rounded-2xl shadow-sm border border-gray-100">
            <label className="flex items-center cursor-pointer p-2 hover:bg-gray-50 rounded-xl transition-colors">
              <span className="mr-3 text-xs font-black text-gray-500 uppercase tracking-widest">Referee Assign</span>
              <div className="relative">
                <input type="checkbox" className="sr-only" checked={liveActiveTournament?.allowRefereeCourtManagement || false} onChange={async (e) => { await updateDoc(doc(db, 'tournaments', liveActiveTournament.id), { allowRefereeCourtManagement: e.target.checked }); }} />
                <div className={`block w-12 h-7 rounded-full transition-colors ${liveActiveTournament?.allowRefereeCourtManagement ? 'bg-green-500' : 'bg-gray-200'}`}></div>
                <div className={`dot absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-md transition transform ${liveActiveTournament?.allowRefereeCourtManagement ? 'translate-x-5' : ''}`}></div>
              </div>
            </label>
            
            <div className="w-px h-8 bg-gray-200 hidden md:block"></div>

            <label className="flex items-center cursor-pointer p-2 hover:bg-gray-50 rounded-xl transition-colors">
              <span className="mr-3 text-xs font-black text-gray-500 uppercase tracking-widest">Custom Matches</span>
              <div className="relative">
                <input type="checkbox" className="sr-only" checked={liveActiveTournament?.allowRefereeCustomMatches || false} onChange={async (e) => { await updateDoc(doc(db, 'tournaments', liveActiveTournament.id), { allowRefereeCustomMatches: e.target.checked }); }} />
                <div className={`block w-12 h-7 rounded-full transition-colors ${liveActiveTournament?.allowRefereeCustomMatches ? 'bg-purple-500' : 'bg-gray-200'}`}></div>
                <div className={`dot absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-md transition transform ${liveActiveTournament?.allowRefereeCustomMatches ? 'translate-x-5' : ''}`}></div>
              </div>
            </label>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: liveActiveTournament?.numCourts || 2 }).map((_, i) => {
            const courtName = `Court ${i + 1}`;
            const matchOnCourt = activeCourtsMatches.find(m => m.courtName === courtName);

            return (
              <div key={courtName} className={`p-5 border-2 rounded-2xl transition-colors ${matchOnCourt ? 'border-green-400 bg-green-50/30 shadow-sm' : 'border-dashed border-gray-300 bg-transparent'}`}>
                <h4 className="font-black text-gray-800 mb-4">{courtName}</h4>
                
                {matchOnCourt ? (
                  <div className="flex flex-col h-full justify-between">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-3">
                      <span className={`inline-block text-[10px] font-black px-2.5 py-1 rounded-md mb-3 tracking-widest uppercase ${matchOnCourt.poolName === 'Final' ? 'bg-yellow-100 text-yellow-700' : matchOnCourt.poolName.includes('Round ') || matchOnCourt.poolName.includes('Knockout') ? 'bg-purple-100 text-purple-700' : customPools.includes(matchOnCourt.poolName) ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-600'}`}>
                        {matchOnCourt.poolName}
                      </span>
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-2 w-full">
                          <div className="flex items-center text-sm font-bold text-gray-900">
                             <span className="w-2.5 h-2.5 rounded-full mr-2 shadow-inner flex-shrink-0" style={{ backgroundColor: liveActiveTournament.teamColors?.[matchOnCourt.teamA] || '#2563EB' }}></span>
                             <span className="truncate">{matchOnCourt.teamA}</span>
                          </div>
                          <div className="flex items-center text-sm font-bold text-gray-900">
                             <span className="w-2.5 h-2.5 rounded-full mr-2 shadow-inner flex-shrink-0" style={{ backgroundColor: liveActiveTournament.teamColors?.[matchOnCourt.teamB] || '#2563EB' }}></span>
                             <span className="truncate">{matchOnCourt.teamB}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-center justify-center bg-gray-50 rounded-lg p-2 ml-4">
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Score</span>
                          <span className="font-mono font-bold text-blue-600">{matchOnCourt.teamAPoints}-{matchOnCourt.teamBPoints}</span>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => unassignMatch(matchOnCourt.id)} className="text-xs text-red-500 font-bold hover:text-red-700 py-1 flex items-center justify-center"><Trash2 size={12} className="mr-1"/> Unassign Court</button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 h-full justify-center">
                    <select value={selectedPendingMatch[courtName] || ''} onChange={(e) => setSelectedPendingMatch(prev => ({...prev, [courtName]: e.target.value}))} className="w-full border-2 border-gray-200 p-3 rounded-xl text-sm bg-white font-medium focus:border-blue-500 focus:outline-none">
                      <option value="">-- Select Pending Match --</option>
                      {assignablePendingMatches.map(m => (
                        <option key={m.id} value={m.id}>[{m.poolName}] {m.teamA} vs {m.teamB}</option>
                      ))}
                    </select>
                    <button onClick={() => assignMatchToCourt(i)} className="bg-gray-900 hover:bg-black text-white px-4 py-3 rounded-xl font-bold text-sm w-full transition-colors shadow-sm">Assign Match</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 🔴 MATCH QUEUES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Pending */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest">Pending ({pendingMatches.length})</h3>
            {completedMatches.filter(m => m.poolName === 'Knockout - Crossover').length === 2 && !matches.find(m => m.tournamentId === liveActiveTournament?.id && m.poolName === 'Final') && (
              <button onClick={handleCreateFinal} className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1.5 text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center">
                <Trophy size={14} className="mr-1.5" /> Generate Final
              </button>
            )}
          </div>
          
          {editingMatch && (
            <div className="bg-white p-5 rounded-2xl border border-blue-200 shadow-md mb-4 animate-fade-in">
              <h4 className="font-black text-blue-900 mb-3 text-xs uppercase tracking-widest">Edit Match Teams</h4>
              <div className="space-y-3">
                <input type="text" value={editForm.teamA} onChange={e => setEditForm({...editForm, teamA: e.target.value})} className="w-full border-2 border-gray-200 p-3 rounded-xl focus:border-blue-500 outline-none font-bold" placeholder="Team A Name" />
                <input type="text" value={editForm.teamB} onChange={e => setEditForm({...editForm, teamB: e.target.value})} className="w-full border-2 border-gray-200 p-3 rounded-xl focus:border-blue-500 outline-none font-bold" placeholder="Team B Name" />
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={saveEditedMatch} className="flex-1 bg-blue-600 text-white py-2 rounded-xl font-bold hover:bg-blue-700 transition-colors">Save</button>
                <button onClick={() => setEditingMatch(null)} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl font-bold hover:bg-gray-200 transition-colors">Cancel</button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar divide-y divide-gray-50">
              {pendingMatches.length === 0 ? (
                <p className="text-sm text-gray-400 p-6 text-center font-medium">No matches in queue.</p>
              ) : (
                pendingMatches.map(m => (
                  <div key={m.id} className="p-4 hover:bg-gray-50 transition-colors flex justify-between items-center group">
                    <div className="truncate pr-4">
                      <span className={`text-[10px] font-black uppercase tracking-widest mr-2 ${m.poolName === 'Final' ? 'text-yellow-600' : m.poolName.includes('Round ') || m.poolName.includes('Knockout') ? 'text-purple-600' : customPools.includes(m.poolName) ? 'text-pink-600' : 'text-blue-600'}`}>
                        {m.poolName}
                      </span>
                      <span className="text-sm font-bold text-gray-800">{m.teamA} <span className="text-gray-400 font-normal mx-1">vs</span> {m.teamB}</span>
                    </div>
                    <button onClick={() => { setEditingMatch(m.id); setEditForm({teamA: m.teamA, teamB: m.teamB}); }} className="opacity-0 group-hover:opacity-100 bg-gray-100 p-2 rounded-lg text-gray-500 hover:text-blue-600 transition-all">
                      <Edit2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Completed */}
        <div>
          <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-4">Completed ({completedMatches.length})</h3>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar divide-y divide-gray-50">
              {completedMatches.length === 0 ? (
                <p className="text-sm text-gray-400 p-6 text-center font-medium">No matches finished.</p>
              ) : (
                completedMatches.map(m => (
                  <div key={m.id} className="p-4 hover:bg-gray-50 transition-colors flex justify-between items-center">
                    <div className="truncate pr-4">
                      <div className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${m.poolName === 'Final' ? 'text-yellow-600' : m.poolName.includes('Round ') || m.poolName.includes('Knockout') ? 'text-purple-600' : customPools.includes(m.poolName) ? 'text-pink-600' : 'text-blue-600'}`}>
                        {m.poolName}
                      </div>
                      <span className="text-sm font-bold text-gray-600">{m.teamA} vs {m.teamB}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block mb-0.5">Winner</span>
                      <span className="inline-flex items-center text-green-600 font-black text-xs bg-green-50 px-2 py-1 rounded">
                        <Trophy size={10} className="mr-1" /> {m.winner}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
