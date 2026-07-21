import React, { useState, useEffect } from 'react';
import { Minus, CheckCircle, Trophy, Lock } from 'lucide-react';
import { db } from '../../config/firebase';
import { collection, onSnapshot, doc, updateDoc, writeBatch, addDoc, serverTimestamp } from 'firebase/firestore';

export default function RefereeView() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [pinError, setPinError] = useState('');

  const [matches, setMatches] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  
  const [selectedPendingMatch, setSelectedPendingMatch] = useState({});

  useEffect(() => {
    const unsubTournaments = onSnapshot(collection(db, 'tournaments'), (snapshot) => {
      setTournaments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubMatches = onSnapshot(collection(db, 'matches'), (snapshot) => {
      setMatches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => { unsubTournaments(); unsubMatches(); };
  }, []);

  // ==========================================
  // 🔴 SAFE HOOK PLACEMENT & DERIVED STATE
  // Variables must be calculated before early returns!
  // ==========================================
  const parentTournament = tournaments.find(t => t.id === selectedTournamentId);
  const activeMatch = matches.find(m => m.id === selectedMatchId);

  // Calculate Deuce & Advantage states at the top level
  const targetPoints = parentTournament?.rules?.points || 21;
  const pointsA = activeMatch?.teamAPoints || 0;
  const pointsB = activeMatch?.teamBPoints || 0;
  const capPoints = targetPoints + 9; 
  
  const isSetWonByA = (pointsA >= targetPoints && (pointsA - pointsB) >= 2) || pointsA === capPoints;
  const isSetWonByB = (pointsB >= targetPoints && (pointsB - pointsA) >= 2) || pointsB === capPoints;
  const isSetWon = isSetWonByA || isSetWonByB;

  const isDeuce = !isSetWon && pointsA >= targetPoints - 1 && pointsB >= targetPoints - 1 && pointsA === pointsB && pointsA < capPoints;
  const hasAdvantage = !isSetWon && pointsA >= targetPoints - 1 && pointsB >= targetPoints - 1 && Math.abs(pointsA - pointsB) === 1 && Math.max(pointsA, pointsB) < capPoints;

  // 🔴 VIBRATION EFFECT (Safely placed before any "return" statements)
  useEffect(() => {
    if (selectedMatchId && activeMatch && (isDeuce || hasAdvantage || isSetWon)) {
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]); // Pulsing vibration pattern
      }
    }
  }, [isDeuce, hasAdvantage, isSetWon, selectedMatchId, activeMatch]);

  const tourneyMatches = matches.filter(m => m.tournamentId === selectedTournamentId);
  const pendingMatches = tourneyMatches.filter(m => m.status === 'pending');
  const activeCourts = tourneyMatches.filter(m => m.status === 'active');
  const completedMatches = tourneyMatches.filter(m => m.status === 'completed');

  // 🔴 FIX: Strict Regex completely blocks assigning unresolved placeholders
  const isMatchResolved = (m) => {
    const regex = /^(\d+)(st|nd|rd|th) Pool ([A-Z])$/;
    return !regex.test(m.teamA) && !regex.test(m.teamB) && m.teamA !== 'BYE' && m.teamB !== 'BYE';
  };
  const assignablePendingMatches = pendingMatches.filter(isMatchResolved);

  // ==========================================
  // SCORING LOGIC
  // ==========================================
  const updateScore = async (team, increment) => {
    if (!activeMatch || activeMatch.status === 'completed') return;

    const currentScore = activeMatch[team === 'A' ? 'teamAPoints' : 'teamBPoints'];
    const newScore = Math.max(0, currentScore + increment);

    const matchRef = doc(db, 'matches', selectedMatchId);
    await updateDoc(matchRef, {
      [team === 'A' ? 'teamAPoints' : 'teamBPoints']: newScore
    });
  };

  const handleEndSet = async (matchData, maxSets) => {
    const teamAPoints = matchData.teamAPoints;
    const teamBPoints = matchData.teamBPoints;

    if (teamAPoints === teamBPoints) {
      alert("A set cannot end in a tie!");
      return;
    }

    if (!window.confirm("Are you sure you want to freeze this set? The scores will be locked.")) return;

    const matchRef = doc(db, 'matches', selectedMatchId);
    const pastSets = matchData.completedSets || [];
    const currentSetNum = matchData.currentSet || 1;

    const setWinner = teamAPoints > teamBPoints ? 'A' : 'B';

    const newPastSets = [...pastSets, {
      teamA: teamAPoints,
      teamB: teamBPoints,
      winner: setWinner
    }];

    let setsWonA = 0;
    let setsWonB = 0;
    newPastSets.forEach(set => {
      if (set.winner === 'A') setsWonA++;
      if (set.winner === 'B') setsWonB++;
    });

    const setsNeededToWin = Math.floor(maxSets / 2) + 1;

    if (setsWonA >= setsNeededToWin || setsWonB >= setsNeededToWin) {
      const matchWinnerName = setsWonA >= setsNeededToWin ? matchData.teamA : matchData.teamB;
      
      await updateDoc(matchRef, {
        completedSets: newPastSets,
        status: 'completed',
        winner: matchWinnerName 
      });
    } else {
      await updateDoc(matchRef, {
        completedSets: newPastSets,
        currentSet: currentSetNum + 1,
        teamAPoints: 0,
        teamBPoints: 0
      });
    }
  };

  const handleUndoLastSet = async (matchData) => {
    if (!window.confirm("Undo the last set? This will revert the score to before it was frozen.")) return;
    
    const matchRef = doc(db, 'matches', selectedMatchId);
    const pastSets = [...(matchData.completedSets || [])];
    
    if (pastSets.length === 0) return;
    
    const lastSet = pastSets.pop(); 
    
    await updateDoc(matchRef, {
      completedSets: pastSets,
      currentSet: matchData.currentSet > 1 ? matchData.currentSet - 1 : 1,
      teamAPoints: lastSet.teamA,
      teamBPoints: lastSet.teamB,
      status: 'active',
      winner: null 
    });
  };

  // ==========================================
  // COURT ASSIGNMENT LOGIC
  // ==========================================
  const assignMatchToCourt = async (courtIndex) => {
    const courtName = `Court ${courtIndex + 1}`;
    const matchIdToAssign = selectedPendingMatch[courtName];
    if (!matchIdToAssign) return alert("Please select a pending match first.");
    await updateDoc(doc(db, 'matches', matchIdToAssign), { status: 'active', courtName: courtName });
    setSelectedPendingMatch(prev => ({...prev, [courtName]: ''}));
  };

  const unassignMatch = async (matchId, e) => {
    e.stopPropagation(); 
    if (window.confirm("Remove this match from the court?")) {
      await updateDoc(doc(db, 'matches', matchId), { status: 'pending', courtName: null, teamAPoints: 0, teamBPoints: 0 });
    }
  };

  // ==========================================
  // TOURNAMENT GENERATION LOGIC 
  // ==========================================
  const getPoolStandings = (poolName) => {
    const targetMatches = parentTournament?.type === 'knockout' 
      ? matches.filter(m => m.tournamentId === parentTournament?.id)
      : matches.filter(m => m.tournamentId === parentTournament?.id && m.poolName === poolName);
    
    let teamNames = parentTournament?.pools?.[poolName] || [];
    if (teamNames.length === 0) {
      const uniqueTeams = new Set();
      targetMatches.forEach(m => {
        if (m.teamA) uniqueTeams.add(m.teamA);
        if (m.teamB && m.teamB !== 'BYE') uniqueTeams.add(m.teamB);
      });
      teamNames = Array.from(uniqueTeams);
    }

    let stats = teamNames.map(t => ({ team: t, won: 0, losses: 0, setsWon: 0, pointsFor: 0, pointsAgainst: 0 }));
    
    const completedTourneyMatches = targetMatches.filter(m => m.status === 'completed');
    completedTourneyMatches.forEach(match => {
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
        tournamentId: parentTournament.id,
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
    
    const playoffMatches = tourneyMatches.filter(m => 
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
    Object.keys(parentTournament.pools).forEach(poolName => {
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
    const crossoverMatches = tourneyMatches.filter(m => m.poolName === 'Knockout - Crossover' && m.status === 'completed');
    
    if (crossoverMatches.length !== 2) {
      return alert(`You need exactly 2 completed crossover matches to automatically create a Final. Currently have ${crossoverMatches.length}.`);
    }

    const teamA = crossoverMatches[0].winner;
    const teamB = crossoverMatches[1].winner;

    if (!teamA || !teamB) {
      return alert("One or both crossover matches are missing a winner!");
    }

    const existingFinal = tourneyMatches.find(m => m.poolName === 'Final');
    if (existingFinal) return alert("The Final match has already been generated!");

    if (window.confirm(`Ready to generate the Final match: ${teamA} vs ${teamB}?`)) {
      await addDoc(collection(db, 'matches'), {
        tournamentId: parentTournament.id,
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
  // RENDER SCREEN 1: TOURNAMENT SELECTION
  // ==========================================
  if (!selectedTournamentId) {
    const activeTournamentsList = tournaments.filter(t => t.status !== 'archived');

    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[60vh]">
        <h2 className="text-2xl font-bold mb-4">Select Tournament</h2>
        {activeTournamentsList.length === 0 ? (
          <p className="text-gray-500 italic">No active tournaments available.</p>
        ) : (
          <div className="space-y-3">
            {activeTournamentsList.map(tourney => (
              <button 
                key={tourney.id} 
                onClick={() => {
                  setSelectedTournamentId(tourney.id);
                  setIsAuthorized(false); 
                  setPinCode('');
                  setPinError('');
                }} 
                className="w-full text-left p-4 border-2 border-gray-100 rounded-xl hover:border-blue-500 active:bg-blue-50 transition-all flex justify-between items-center"
              >
                <div>
                  <div className="font-bold text-lg text-gray-800">{tourney.tournamentName || 'Unnamed Tournament'}</div>
                  <div className="text-sm text-gray-500 capitalize">{tourney.type?.replace('-', ' ')} • Best of {tourney.rules?.sets || 3}</div>
                </div>
                <Lock className="text-gray-300" size={20} />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER SCREEN 1.5: PIN CODE ENTRY 
  // ==========================================
  if (selectedTournamentId && !isAuthorized) {
    const handlePinSubmit = (e) => {
      e.preventDefault();
      if (!parentTournament.refereeCode || pinCode === parentTournament.refereeCode) {
        setIsAuthorized(true);
        setPinError('');
      } else {
        setPinError('Incorrect Referee Code. Please ask the Admin.');
        setPinCode('');
      }
    };

    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[60vh] flex flex-col justify-center items-center relative">
        <button 
          onClick={() => setSelectedTournamentId(null)} 
          className="absolute top-6 left-6 text-xs text-blue-600 font-bold uppercase"
        >
          ← Back
        </button>
        
        <div className="bg-blue-50 p-4 rounded-full mb-4">
          <Lock className="text-blue-600" size={32} />
        </div>
        <h2 className="text-2xl font-bold mb-2 text-center">{parentTournament?.tournamentName}</h2>
        <p className="text-gray-500 text-sm mb-6 text-center">Enter the 6-digit referee code to access courts.</p>
        
        <form onSubmit={handlePinSubmit} className="w-full max-w-xs space-y-4">
          <input 
            type="tel" 
            maxLength="6"
            placeholder="000000"
            value={pinCode}
            onChange={(e) => setPinCode(e.target.value)}
            className="w-full border-2 border-gray-300 p-4 rounded-xl text-center text-3xl font-mono tracking-[0.5em] focus:border-blue-500 focus:outline-none"
            required
            autoFocus
          />
          {pinError && <p className="text-red-500 text-sm font-bold text-center">{pinError}</p>}
          <button 
            type="submit" 
            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg active:bg-blue-700"
          >
            Unlock Dashboard
          </button>
        </form>
      </div>
    );
  }

  // ==========================================
  // RENDER SCREEN 2: COURT SELECTION
  // ==========================================
  if (!selectedMatchId && isAuthorized) {
    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[60vh]">
        <button onClick={() => setSelectedTournamentId(null)} className="text-xs text-blue-600 font-bold uppercase mb-4 block hover:underline">← Back to Tournaments</button>
        
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold mb-1 text-gray-800">{parentTournament?.tournamentName}</h2>
            <h3 className="text-md font-semibold text-gray-500">Select Assigned Court</h3>
          </div>
          
          {parentTournament?.allowRefereeCourtManagement && (
            <div className="flex flex-col items-end gap-2">
              {parentTournament.type === 'knockout' ? (
                <button onClick={handleGenerateNextRound} className="bg-purple-600 text-white px-3 py-1.5 text-xs font-bold rounded shadow-sm hover:bg-purple-700 transition-colors whitespace-nowrap">
                  ⚡ Generate Next Round
                </button>
              ) : (
                <>
                  <button onClick={handleAutoResolve} className="bg-purple-600 text-white px-3 py-1.5 text-xs font-bold rounded shadow-sm hover:bg-purple-700 transition-colors whitespace-nowrap">
                    ⚡ Auto-Resolve
                  </button>
                  {completedMatches.filter(m => m.poolName === 'Knockout - Crossover').length === 2 && !tourneyMatches.find(m => m.poolName === 'Final') && (
                    <button onClick={handleCreateFinal} className="bg-yellow-500 text-white px-3 py-1.5 text-xs font-bold rounded shadow-sm hover:bg-yellow-600 transition-colors whitespace-nowrap">
                      🏆 Generate Final Match
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        
        {parentTournament?.allowRefereeCourtManagement ? (
          <div className="space-y-4">
            {Array.from({ length: parentTournament.numCourts || 2 }).map((_, i) => {
              const courtName = `Court ${i + 1}`;
              const matchOnCourt = activeCourts.find(m => m.courtName === courtName);

              return (
                <div key={courtName} className={`p-4 border-2 rounded-xl ${matchOnCourt ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                  <h4 className="font-bold text-gray-800 mb-3">{courtName}</h4>
                  
                  {matchOnCourt ? (
                    <div>
                      <button onClick={() => setSelectedMatchId(matchOnCourt.id)} className="w-full text-left bg-white p-3 rounded shadow-sm border mb-2 flex justify-between items-center hover:border-blue-500 active:bg-blue-100 transition-colors">
                        <div>
                          <div className="text-xs font-bold text-blue-600 mb-1">[{matchOnCourt.poolName}]</div>
                          <div className="text-sm font-bold text-gray-800 flex items-center">
                             <span className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: parentTournament.teamColors?.[matchOnCourt.teamA] || '#2563EB' }}></span>
                             {matchOnCourt.teamA} vs {matchOnCourt.teamB}
                             <span className="w-2 h-2 rounded-full ml-2" style={{ backgroundColor: parentTournament.teamColors?.[matchOnCourt.teamB] || '#2563EB' }}></span>
                          </div>
                        </div>
                        <span className="text-blue-600 font-bold text-xs uppercase bg-blue-100 px-3 py-2 rounded-lg">Score →</span>
                      </button>
                      <button onClick={(e) => unassignMatch(matchOnCourt.id, e)} className="text-xs text-red-600 font-bold hover:underline py-1">Unassign Court</button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 w-full">
                      {/* 🔴 FIX: Now mapping over assignablePendingMatches to hide placeholders */}
                      <select value={selectedPendingMatch[courtName] || ''} onChange={(e) => setSelectedPendingMatch(prev => ({...prev, [courtName]: e.target.value}))} className="flex-1 border-2 border-gray-200 p-3 rounded-lg text-sm w-full bg-white">
                        <option value="">-- Select Pending Match --</option>
                        {assignablePendingMatches.map(m => (
                          <option key={m.id} value={m.id}>[{m.poolName}] {m.teamA} vs {m.teamB}</option>
                        ))}
                      </select>
                      <button onClick={() => assignMatchToCourt(i)} className="bg-blue-600 text-white px-4 py-3 rounded-lg font-bold text-sm w-full active:bg-blue-700 shadow-sm">Assign to {courtName}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            {activeCourts.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mt-4">
                <p className="text-yellow-700 text-sm font-bold mb-1">No matches assigned!</p>
                <p className="text-yellow-600 text-xs">Waiting for Admin to assign matches to courts.</p>
              </div>
            ) : (
              <div className="space-y-3 mt-4">
                {activeCourts.map(match => (
                  <button key={match.id} onClick={() => setSelectedMatchId(match.id)} className="w-full text-left p-4 border-2 border-gray-100 rounded-xl hover:border-blue-500 active:bg-blue-50 transition-all flex justify-between items-center">
                    <div>
                      <div className="font-bold text-lg text-gray-800">{match.courtName}</div>
                      <div className="text-sm text-gray-500"><strong className="text-blue-600">[{match.poolName}]</strong> {match.teamA} vs {match.teamB}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER SCREEN 3: ACTIVE SCORING UI
  // ==========================================
  if (!activeMatch) return <div className="p-4 text-center">Loading match data...</div>;

  const maxSets = parentTournament.rules?.sets || 3;
  const currentSetNum = activeMatch.currentSet || 1;
  const pastSets = activeMatch.completedSets || [];
  const isMatchCompleted = activeMatch.status === 'completed';

  const advantageTeamName = pointsA > pointsB ? activeMatch.teamA : activeMatch.teamB;
  const colorTeamA = parentTournament?.teamColors?.[activeMatch.teamA] || '#2563EB'; 
  const colorTeamB = parentTournament?.teamColors?.[activeMatch.teamB] || '#DC2626'; 

  return (
    <div className="flex flex-col min-h-[85vh] bg-gray-50 p-2 rounded-xl">
      <div className={`bg-white p-4 rounded-xl shadow-sm mb-4 text-center relative border-b-4 ${isMatchCompleted ? 'border-green-500' : 'border-blue-600'}`}>
        <button onClick={() => setSelectedMatchId(null)} className="absolute left-4 top-4 text-sm text-blue-600 font-semibold hover:underline">← Courts</button>
        <h2 className="text-xl font-bold text-gray-800 mt-6">{activeMatch.courtName}</h2>
        
        {isMatchCompleted ? (
          <div className="mt-2 inline-flex items-center bg-green-100 text-green-800 px-4 py-1 rounded-full font-bold text-sm">
            <Trophy size={16} className="mr-2" />
            WINNER: {activeMatch.winner}
          </div>
        ) : (
          <p className="text-sm font-bold text-gray-500 uppercase mt-1">
            Set {currentSetNum} of {maxSets} • Play to {targetPoints}
          </p>
        )}
      </div>

      {pastSets.length > 0 && (
        <div className="flex justify-center space-x-2 mb-4 overflow-x-auto pb-2">
          {pastSets.map((set, idx) => (
            <div key={idx} className={`px-3 py-1 rounded text-sm font-bold whitespace-nowrap border-2 ${set.winner === 'A' ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
              S{idx + 1}: {set.teamA} - {set.teamB}
            </div>
          ))}
        </div>
      )}
      
      {!isMatchCompleted && (
        <>
          {isSetWon && (
            <div className="bg-green-100 border border-green-400 text-green-800 p-3 rounded-lg text-center font-bold mb-4 shadow-sm animate-pulse">
              🎉 Set Finished! Please Freeze the Set.
            </div>
          )}
          {isDeuce && (
            <div className="bg-red-600 border-2 border-red-800 text-white p-3 rounded-lg text-center font-black tracking-widest mb-4 shadow-lg animate-pulse uppercase">
              🔥 DEUCE! Win by 2 points!
            </div>
          )}
          {hasAdvantage && (
            <div className="bg-yellow-400 border-2 border-yellow-600 text-yellow-900 p-3 rounded-lg text-center font-black tracking-widest mb-4 shadow-lg animate-pulse uppercase">
              ⚡ ADVANTAGE {advantageTeamName}!
            </div>
          )}
        </>
      )}

      <div className="flex-1 grid grid-cols-2 gap-4">
        <div className="flex flex-col space-y-3">
          <div className="text-white p-3 rounded-t-xl text-center shadow" style={{ backgroundColor: colorTeamA }}>
            <h3 className="font-semibold text-base truncate">{activeMatch.teamA}</h3>
          </div>
          <button 
            onClick={() => updateScore('A', 1)} 
            disabled={isMatchCompleted || isSetWon} 
            className="flex-1 bg-white active:bg-gray-100 text-gray-800 border-2 rounded-xl flex items-center justify-center shadow-sm transition-colors min-h-[160px] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderColor: colorTeamA }}
          >
            <span className="text-7xl font-bold">{isMatchCompleted ? '-' : activeMatch.teamAPoints}</span>
          </button>
          {!isMatchCompleted && (
            <button onClick={() => updateScore('A', -1)} className="p-4 bg-white border-2 border-gray-200 rounded-b-xl flex justify-center text-gray-600 active:bg-gray-100">
              <Minus size={24} />
            </button>
          )}
        </div>

        <div className="flex flex-col space-y-3">
          <div className="text-white p-3 rounded-t-xl text-center shadow" style={{ backgroundColor: colorTeamB }}>
            <h3 className="font-semibold text-base truncate">{activeMatch.teamB}</h3>
          </div>
          <button 
            onClick={() => updateScore('B', 1)} 
            disabled={isMatchCompleted || isSetWon} 
            className="flex-1 bg-white active:bg-gray-100 text-gray-800 border-2 rounded-xl flex items-center justify-center shadow-sm transition-colors min-h-[160px] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderColor: colorTeamB }}
          >
            <span className="text-7xl font-bold">{isMatchCompleted ? '-' : activeMatch.teamBPoints}</span>
          </button>
          {!isMatchCompleted && (
            <button onClick={() => updateScore('B', -1)} className="p-4 bg-white border-2 border-gray-200 rounded-b-xl flex justify-center text-gray-600 active:bg-gray-100">
              <Minus size={24} />
            </button>
          )}
        </div>
      </div>

      {!isMatchCompleted ? (
        <button 
          onClick={() => handleEndSet(activeMatch, maxSets)} 
          className={`mt-6 w-full text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center transition-all shadow-sm ${
            isSetWon 
              ? 'bg-green-600 active:bg-green-700 animate-pulse border-2 border-green-800' 
              : 'bg-gray-800 active:bg-gray-700'
          }`}
        >
          <CheckCircle className="mr-2" /> 
          Freeze Set {currentSetNum}
        </button>
      ) : (
        <button onClick={() => setSelectedMatchId(null)} className="mt-6 w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg active:bg-blue-700 flex items-center justify-center shadow-md transition-colors">
          ← Back to Assigned Courts
        </button>
      )}

      {(isMatchCompleted || pastSets.length > 0) && (
        <button 
          onClick={() => handleUndoLastSet(activeMatch)} 
          className="mt-4 w-full bg-orange-100 text-orange-700 py-3 rounded-xl font-bold active:bg-orange-200 border border-orange-300 transition-colors"
        >
          ↺ Undo Last Frozen Set
        </button>
      )}
    </div>
  );
}
