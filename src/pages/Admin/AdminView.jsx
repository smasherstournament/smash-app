import React, { useState, useEffect } from 'react';
import { db, auth } from '../../config/firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, setDoc, updateDoc, addDoc, deleteDoc, onSnapshot, serverTimestamp, query, where, getDocs, writeBatch } from 'firebase/firestore';

export default function AdminView() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [view, setView] = useState('hub'); 
  const [tournaments, setTournaments] = useState([]);
  const [activeTournament, setActiveTournament] = useState(null);
  
  const [tourneyConfig, setTourneyConfig] = useState({ 
    name: '', sets: 3, points: 21, numTeams: 4, numPools: 2, numCourts: 2, tableTops: 2, type: 'round-robin' 
  });
  const [teamNames, setTeamNames] = useState([]);

  const [matches, setMatches] = useState([]);
  const [selectedPendingMatch, setSelectedPendingMatch] = useState({});
  const [editingMatch, setEditingMatch] = useState(null);
  const [editForm, setEditForm] = useState({ teamA: '', teamB: '' });

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
      setAuthError('Invalid email or password.');
    }
  };

  const handleSaveTournament = async () => {
    const poolsMap = {};
    const effectivePools = tourneyConfig.type === 'knockout' ? 1 : (tourneyConfig.numPools || 2);
    
    for (let i = 0; i < effectivePools; i++) {
      poolsMap[tourneyConfig.type === 'knockout' ? 'Main Bracket' : `Pool ${String.fromCharCode(65 + i)}`] = [];
    }
    
    teamNames.forEach((team, index) => {
      const poolName = tourneyConfig.type === 'knockout' ? 'Main Bracket' : `Pool ${String.fromCharCode(65 + (index % effectivePools))}`;
      poolsMap[poolName].push(team || `Team ${index + 1}`);
    });

    try {
      const generatedRefCode = Math.floor(100000 + Math.random() * 900000).toString();
      const safeDocId = tourneyConfig.name.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now();
      
      const tourneyData = {
        tournamentName: tourneyConfig.name,
        type: tourneyConfig.type,
        rules: { 
          sets: Number(tourneyConfig.sets) || 3, 
          points: Number(tourneyConfig.points) || 21,
          tableTops: Number(tourneyConfig.tableTops) || 2
        },
        pools: poolsMap,
        numCourts: Number(tourneyConfig.numCourts) || 2,
        refereeCode: generatedRefCode,
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
        const tops = Number(tourneyConfig.tableTops) || 2;
        const getOrdinal = (n) => {
          const s = ["th", "st", "nd", "rd"];
          const v = n % 100;
          return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };

        for (let p = 0; p < poolNamesList.length; p += 2) {
          const pool1 = poolNamesList[p];
          const pool2 = poolNamesList[p + 1];
          
          if (pool1 && pool2) {
            for (let i = 1; i <= tops; i++) {
              const matchRef = doc(collection(db, 'matches'));
              batch.set(matchRef, {
                tournamentId: safeDocId, 
                poolName: 'Knockout - Crossover', 
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
          const matchRef = doc(collection(db, 'matches'));
          batch.set(matchRef, {
            tournamentId: safeDocId, poolName: 'Round 1', teamA: teams[i], teamB: teams[i+1] || 'BYE (Auto-Win)',
            teamAPoints: 0, teamBPoints: 0, currentSet: 1, completedSets: [],
            status: teams[i+1] ? 'pending' : 'completed', courtName: null, createdAt: serverTimestamp()
          });
        }
      }
      
      await batch.commit();

      setActiveTournament({ id: safeDocId, ...tourneyData });
      setView('tournament-details');
      setTourneyConfig({ name: '', sets: 3, points: 21, numTeams: 4, numPools: 2, numCourts: 2, tableTops: 2, type: 'round-robin' });
    } catch (error) {
      alert("Failed to save tournament.");
    }
  };

  const handleDeleteTournament = async (id) => {
    if (window.confirm("Delete this tournament and ALL its matches?")) {
      const q = query(collection(db, 'matches'), where("tournamentId", "==", id));
      const querySnapshot = await getDocs(q);
      const batch = writeBatch(db);
      querySnapshot.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      
      await deleteDoc(doc(db, 'tournaments', id));
      if (activeTournament?.id === id) setView('hub');
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

  // --- UPDATED: SMARTER STANDINGS CALCULATOR ---
  const getPoolStandings = (poolName) => {
    const tourneyMatches = matches.filter(m => m.tournamentId === activeTournament?.id && m.poolName === poolName);
    
    // 1. If standard pool, use defined teams. If knockout/final, extract teams from matches dynamically.
    let teamNames = activeTournament?.pools[poolName] || [];
    if (teamNames.length === 0) {
      const uniqueTeams = new Set();
      tourneyMatches.forEach(m => {
        if (m.teamA) uniqueTeams.add(m.teamA);
        if (m.teamB) uniqueTeams.add(m.teamB);
      });
      teamNames = Array.from(uniqueTeams);
    }

    let stats = teamNames.map(t => ({ team: t, won: 0, setsWon: 0, pointsFor: 0, pointsAgainst: 0 }));
    
    const completedMatches = tourneyMatches.filter(m => m.status === 'completed');
    completedMatches.forEach(match => {
      const winnerStat = stats.find(s => s.team === match.winner);
      if (winnerStat) winnerStat.won += 1;

      match.completedSets?.forEach(set => {
        const teamAStat = stats.find(s => s.team === match.teamA);
        const teamBStat = stats.find(s => s.team === match.teamB);
        if (teamAStat) {
          if (set.winner === 'A') teamAStat.setsWon += 1;
          teamAStat.pointsFor += set.teamA;
          teamAStat.pointsAgainst += set.teamB;
        }
        if (teamBStat) {
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
        return b.pointDiff - a.pointDiff;                
      });
  };

  const handleAutoResolve = async () => {
    if (!window.confirm("Auto-resolve bracket? This will overwrite placeholders.")) return;

    const batch = writeBatch(db);
    const crossoverMatches = matches.filter(m => m.tournamentId === activeTournament?.id && m.poolName === 'Knockout - Crossover' && m.status === 'pending');
    
    const allStandings = {};
    Object.keys(activeTournament.pools).forEach(poolName => {
      allStandings[poolName] = getPoolStandings(poolName);
    });

    const regex = /(\d+)(st|nd|rd|th) Pool ([A-Z])/;

    crossoverMatches.forEach(match => {
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
    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[70vh]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Tournament Hub</h2>
          <button onClick={() => signOut(auth)} className="text-sm text-red-600 font-medium">Logout</button>
        </div>
        <button onClick={() => setView('wizard-config')} className="w-full mb-6 bg-blue-600 text-white py-3 rounded-lg font-bold shadow-sm">+ Create New Tournament</button>
        <div className="space-y-3">
          {tournaments.map(t => (
            <div key={t.id} className="border p-4 rounded-lg flex justify-between items-center hover:bg-gray-50">
              <div>
                <h4 className="font-bold text-lg">{t.tournamentName || 'Unnamed'}</h4>
                <p className="text-xs text-gray-500 capitalize">{t.type === 'round-robin' ? 'Round Robin' : 'Knockout'}</p>
              </div>
              <div className="flex space-x-2">
                <button onClick={() => { setActiveTournament(t); setView('tournament-details'); }} className="bg-gray-800 text-white px-4 py-2 rounded font-medium">Open</button>
                <button onClick={() => handleDeleteTournament(t.id)} className="bg-red-100 text-red-600 px-3 py-2 rounded font-medium">X</button>
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
          <h2 className="text-2xl font-bold">{view === 'wizard-config' ? 'Tournament Setup' : 'Name the Teams'}</h2>
          <button onClick={() => setView('hub')} className="text-sm text-gray-500 font-medium">Cancel</button>
        </div>

        {view === 'wizard-config' ? (
          <div className="space-y-4">
            <input type="text" placeholder="Tournament Name" value={tourneyConfig.name} onChange={(e) => setTourneyConfig({...tourneyConfig, name: e.target.value})} className="w-full border p-2 rounded text-lg font-bold" />
            <select value={tourneyConfig.type} onChange={(e) => setTourneyConfig({...tourneyConfig, type: e.target.value})} className="w-full border p-2 rounded font-medium bg-gray-50">
              <option value="round-robin">Round Robin (Pools)</option>
              <option value="knockout">Knockout Bracket</option>
            </select>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div><label className="text-xs font-bold text-gray-500 uppercase">Total Teams</label><input type="number" value={tourneyConfig.numTeams} onChange={(e) => setTourneyConfig({...tourneyConfig, numTeams: parseInt(e.target.value) || ''})} className="w-full border p-2 rounded mt-1" /></div>
              {tourneyConfig.type === 'round-robin' && (
                <div><label className="text-xs font-bold text-gray-500 uppercase">Pools (Even Only)</label><input type="number" min="2" step="2" value={tourneyConfig.numPools} onChange={(e) => setTourneyConfig({...tourneyConfig, numPools: parseInt(e.target.value) || ''})} className="w-full border p-2 rounded mt-1" /></div>
              )}
              {tourneyConfig.type === 'round-robin' && (
                <div><label className="text-xs font-bold text-blue-600 uppercase">Table Tops</label><input type="number" min="1" value={tourneyConfig.tableTops} onChange={(e) => setTourneyConfig({...tourneyConfig, tableTops: parseInt(e.target.value) || ''})} className="w-full border-2 border-blue-200 p-2 rounded mt-1" /></div>
              )}
              <div><label className="text-xs font-bold text-gray-500 uppercase">Courts</label><input type="number" value={tourneyConfig.numCourts} onChange={(e) => setTourneyConfig({...tourneyConfig, numCourts: parseInt(e.target.value) || ''})} className="w-full border p-2 rounded mt-1" /></div>
            </div>
            <button onClick={() => { setTeamNames(Array(tourneyConfig.numTeams || 4).fill('')); setView('wizard-teams'); }} disabled={!tourneyConfig.name || (tourneyConfig.type === 'round-robin' && tourneyConfig.numPools % 2 !== 0)} className="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg font-bold disabled:bg-gray-400">Next</button>
          </div>
        ) : (
          <div>
            <div className="space-y-3 mb-6 max-h-[50vh] overflow-y-auto">
              {Array.from({ length: tourneyConfig.numTeams || 4 }).map((_, index) => (
                <input key={index} type="text" value={teamNames[index] || ''} onChange={(e) => { const newNames = [...teamNames]; newNames[index] = e.target.value; setTeamNames(newNames); }} placeholder={`Team ${index + 1}`} className="w-full border p-2 rounded" />
              ))}
            </div>
            <button onClick={handleSaveTournament} className="w-full bg-green-600 text-white py-3 rounded-lg font-bold">Generate Tournament</button>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER: TOURNAMENT DETAILS & SCHEDULER
  // ==========================================
  const tourneyMatches = matches.filter(m => m.tournamentId === activeTournament?.id);
  const pendingMatches = tourneyMatches.filter(m => m.status === 'pending');
  const activeCourtsMatches = tourneyMatches.filter(m => m.status === 'active');
  const completedMatches = tourneyMatches.filter(m => m.status === 'completed');

  // Determine which standings tables to display
  const standardPools = Object.keys(activeTournament?.pools || {});
  const hasCrossovers = tourneyMatches.some(m => m.poolName === 'Knockout - Crossover');
  const hasFinal = tourneyMatches.some(m => m.poolName === 'Final');
  
  const allDisplayPools = [...standardPools];
  if (hasCrossovers) allDisplayPools.push('Knockout - Crossover');
  if (hasFinal) allDisplayPools.push('Final');

  return (
    <div className="p-4 bg-white rounded-xl shadow-sm min-h-[70vh]">
      <div className="flex justify-between items-start mb-6 border-b pb-4">
        <div>
          <button onClick={() => setView('hub')} className="text-xs text-blue-600 font-bold uppercase mb-1">← Back to Hub</button>
          <h2 className="text-2xl font-bold text-gray-800">{activeTournament?.tournamentName}</h2>
        </div>
        <div className="text-right bg-blue-50 p-3 rounded-lg border border-blue-100 min-w-[140px]">
          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">Referee Code</p>
          <p className="text-2xl font-mono font-bold tracking-widest text-gray-800">{activeTournament?.refereeCode || 'N/A'}</p>
        </div>
      </div>

      {activeTournament?.type === 'round-robin' && (
        <div className="mb-8 border-b pb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-gray-500 uppercase">Live Pool Standings & Playoffs</h3>
            <button onClick={handleAutoResolve} className="bg-purple-600 text-white px-3 py-1 text-xs font-bold rounded shadow-sm hover:bg-purple-700">
              ⚡ Auto-Resolve Knockouts
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {allDisplayPools.map(poolName => {
              const standings = getPoolStandings(poolName);
              // Hide empty crossover/final tables if no teams have been resolved yet
              if (standings.length === 0) return null;

              return (
                <div key={poolName} className="border rounded-lg overflow-hidden bg-white shadow-sm">
                  <div className={`text-white text-xs font-bold px-3 py-2 uppercase ${poolName === 'Final' ? 'bg-yellow-500' : poolName.includes('Knockout') ? 'bg-purple-600' : 'bg-blue-600'}`}>
                    {poolName}
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-100 text-gray-600 text-xs uppercase">
                      <tr>
                        <th className="px-3 py-2">Team</th>
                        <th className="px-2 py-2 text-center">W</th>
                        <th className="px-2 py-2 text-center">Sets</th>
                        <th className="px-2 py-2 text-center" title="Point Differential">Pt Diff</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {standings.map((stat, idx) => {
                        const isChampion = poolName === 'Final' && idx === 0 && stat.won > 0;
                        const isKnockoutWinner = poolName === 'Knockout - Crossover' && stat.won > 0;
                        const isPoolQualifier = standardPools.includes(poolName) && idx < activeTournament.rules.tableTops;
                        
                        return (
                          <tr key={stat.team} className={isChampion ? "bg-yellow-100 font-bold" : (isKnockoutWinner || isPoolQualifier) ? "bg-green-50" : ""}>
                            <td className="px-3 py-2 font-medium">
                              {stat.team} {isChampion && " 🏆"}
                            </td>
                            <td className="px-2 py-2 text-center font-bold">{stat.won}</td>
                            <td className="px-2 py-2 text-center text-gray-600">{stat.setsWon}</td>
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
      <h3 className="text-sm font-bold text-gray-500 uppercase mb-3">Court Manager</h3>
      <div className="space-y-3 mb-8">
        {Array.from({ length: activeTournament?.numCourts || 2 }).map((_, i) => {
          const courtName = `Court ${i + 1}`;
          const matchOnCourt = activeCourtsMatches.find(m => m.courtName === courtName);

          return (
            <div key={courtName} className={`p-4 border-2 rounded-lg ${matchOnCourt ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
              <h4 className="font-bold text-gray-800 mb-2">{courtName}</h4>
              
              {matchOnCourt ? (
                <div>
                  <div className="flex justify-between items-center bg-white p-3 rounded border shadow-sm mb-2">
                    <div>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${matchOnCourt.poolName === 'Final' ? 'bg-yellow-100 text-yellow-700' : matchOnCourt.poolName.includes('Knockout') ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-600'}`}>
                        {matchOnCourt.poolName}
                      </span>
                      <p className="text-sm font-bold mt-2">{matchOnCourt.teamA} vs {matchOnCourt.teamB}</p>
                    </div>
                  </div>
                  <button onClick={() => unassignMatch(matchOnCourt.id)} className="text-xs text-red-600 font-bold underline">Unassign Court</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select value={selectedPendingMatch[courtName] || ''} onChange={(e) => setSelectedPendingMatch(prev => ({...prev, [courtName]: e.target.value}))} className="flex-1 border p-2 rounded text-sm">
                    <option value="">-- Select Pending Match --</option>
                    {pendingMatches.map(m => (
                      <option key={m.id} value={m.id}>[{m.poolName}] {m.teamA} vs {m.teamB}</option>
                    ))}
                  </select>
                  <button onClick={() => assignMatchToCourt(i)} className="bg-blue-600 text-white px-4 py-2 rounded font-bold text-sm">Assign</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* --- MATCH QUEUE (PENDING) --- */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-gray-500 uppercase">Pending Matches ({pendingMatches.length})</h3>
        
        {completedMatches.filter(m => m.poolName === 'Knockout - Crossover').length === 2 && !matches.find(m => m.tournamentId === activeTournament?.id && m.poolName === 'Final') && (
          <button onClick={handleCreateFinal} className="bg-yellow-500 text-white px-3 py-1 text-xs font-bold rounded shadow-sm hover:bg-yellow-600">
            🏆 Generate Final Match
          </button>
        )}
      </div>
      
      {editingMatch ? (
        <div className="bg-white p-4 rounded-lg border shadow mb-4">
          <h4 className="font-bold mb-2">Resolve Teams</h4>
          <input type="text" value={editForm.teamA} onChange={e => setEditForm({...editForm, teamA: e.target.value})} className="w-full border p-2 mb-2 rounded" placeholder="Team A Name" />
          <input type="text" value={editForm.teamB} onChange={e => setEditForm({...editForm, teamB: e.target.value})} className="w-full border p-2 mb-3 rounded" placeholder="Team B Name" />
          <div className="flex gap-2">
            <button onClick={saveEditedMatch} className="bg-green-600 text-white px-4 py-2 rounded font-bold">Save</button>
            <button onClick={() => setEditingMatch(null)} className="bg-gray-200 px-4 py-2 rounded font-bold">Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="bg-gray-50 p-2 rounded-lg border max-h-48 overflow-y-auto mb-6">
        {pendingMatches.length === 0 && <p className="text-sm text-gray-500 p-2 italic">No matches pending.</p>}
        {pendingMatches.map(m => (
          <div key={m.id} className="text-sm border-b py-2 flex justify-between items-center pr-2">
            <span><strong className={m.poolName === 'Final' ? 'text-yellow-600' : m.poolName.includes('Knockout') ? 'text-purple-600' : 'text-blue-600'}>[{m.poolName}]</strong> {m.teamA} vs {m.teamB}</span>
            <button onClick={() => { setEditingMatch(m.id); setEditForm({teamA: m.teamA, teamB: m.teamB}); }} className="text-xs text-blue-600 font-bold underline">Edit</button>
          </div>
        ))}
      </div>

      {/* --- COMPLETED MATCHES --- */}
      <h3 className="text-sm font-bold text-gray-500 uppercase mb-3">Completed Matches ({completedMatches.length})</h3>
      <div className="bg-gray-50 p-2 rounded-lg border max-h-48 overflow-y-auto">
        {completedMatches.length === 0 && <p className="text-sm text-gray-500 p-2 italic">No matches completed yet.</p>}
        {completedMatches.map(m => (
          <div key={m.id} className="text-sm border-b py-2 flex justify-between">
            <span><strong className={m.poolName === 'Final' ? 'text-yellow-600' : m.poolName.includes('Knockout') ? 'text-purple-600' : 'text-blue-600'}>[{m.poolName}]</strong> {m.teamA} vs {m.teamB}</span>
            <span className="font-bold text-green-600">Winner: {m.winner || 'Finished'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}