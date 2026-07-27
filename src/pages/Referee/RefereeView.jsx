import React, { useState, useEffect } from 'react';
import { Minus, CheckCircle, Trophy, Lock, ChevronLeft, Calendar, ShieldAlert, Plus, Trash2, Zap, PlayCircle, XCircle } from 'lucide-react';
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

  // 🔴 Custom Match State
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState({ title: 'Exhibition', sets: 3, points: 21, courtName: '', teamA: '', teamB: '' });

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
  // SAFE HOOK PLACEMENT & DERIVED STATE
  // ==========================================
  const parentTournament = tournaments.find(t => t.id === selectedTournamentId);
  const activeMatch = matches.find(m => m.id === selectedMatchId);

  const targetPoints = activeMatch?.customRules?.points || parentTournament?.rules?.points || 21;
  const pointsA = activeMatch?.teamAPoints || 0;
  const pointsB = activeMatch?.teamBPoints || 0;
  const capPoints = targetPoints + 9; 
  
  const isSetWonByA = (pointsA >= targetPoints && (pointsA - pointsB) >= 2) || pointsA === capPoints;
  const isSetWonByB = (pointsB >= targetPoints && (pointsB - pointsA) >= 2) || pointsB === capPoints;
  const isSetWon = isSetWonByA || isSetWonByB;

  const isDeuce = !isSetWon && pointsA >= targetPoints - 1 && pointsB >= targetPoints - 1 && pointsA === pointsB && pointsA < capPoints;
  const hasAdvantage = !isSetWon && pointsA >= targetPoints - 1 && pointsB >= targetPoints - 1 && Math.abs(pointsA - pointsB) === 1 && Math.max(pointsA, pointsB) < capPoints;

  useEffect(() => {
    if (selectedMatchId && activeMatch && (isDeuce || hasAdvantage || isSetWon)) {
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]); 
      }
    }
  }, [isDeuce, hasAdvantage, isSetWon, selectedMatchId, activeMatch]);

  const tourneyMatches = matches.filter(m => m.tournamentId === selectedTournamentId);
  const pendingMatches = tourneyMatches.filter(m => m.status === 'pending');
  const activeCourts = tourneyMatches.filter(m => m.status === 'active');
  const completedMatches = tourneyMatches.filter(m => m.status === 'completed');

  const isMatchResolved = (m) => {
    const regex = /^(\d+)(st|nd|rd|th) Pool ([A-Z])$/;
    return !regex.test(m.teamA) && !regex.test(m.teamB) && m.teamA !== 'BYE' && m.teamB !== 'BYE';
  };
  const assignablePendingMatches = pendingMatches.filter(isMatchResolved);

  // ==========================================
  // CUSTOM MATCH CREATION
  // ==========================================
  const handleCreateCustomMatch = async (e) => {
    e.preventDefault();
    if (!customForm.teamA || !customForm.teamB) return alert("Please enter both Team names.");

    if (customForm.courtName) {
      const existingMatch = activeCourts.find(m => m.courtName === customForm.courtName);
      if (existingMatch) {
        if (!window.confirm(`${customForm.courtName} is occupied. Unassign the current match and force this one?`)) return;
        await updateDoc(doc(db, 'matches', existingMatch.id), { status: 'pending', courtName: null, teamAPoints: 0, teamBPoints: 0 });
      }
    }

    const matchRef = await addDoc(collection(db, 'matches'), {
      tournamentId: selectedTournamentId,
      poolName: customForm.title || 'Exhibition',
      teamA: customForm.teamA,
      teamB: customForm.teamB,
      teamAPoints: 0,
      teamBPoints: 0,
      currentSet: 1,
      completedSets: [],
      status: customForm.courtName ? 'active' : 'pending',
      courtName: customForm.courtName || null,
      customRules: {
        sets: parseInt(customForm.sets) || 3,
        points: parseInt(customForm.points) || 21
      },
      createdAt: serverTimestamp(),
      isCustom: true
    });

    setShowCustomForm(false);
    setCustomForm({ title: 'Exhibition', sets: 3, points: 21, courtName: '', teamA: '', teamB: '' });
    
    if (customForm.courtName) setSelectedMatchId(matchRef.id);
    else alert("Custom Match added to Pending Queue!");
  };

  // ==========================================
  // SCORING LOGIC
  // ==========================================
  const updateScore = async (team, increment) => {
    if (!activeMatch || activeMatch.status === 'completed') return;
    const currentScore = activeMatch[team === 'A' ? 'teamAPoints' : 'teamBPoints'];
    const newScore = Math.max(0, currentScore + increment);
    await updateDoc(doc(db, 'matches', selectedMatchId), { [team === 'A' ? 'teamAPoints' : 'teamBPoints']: newScore });
  };

  const handleEndSet = async (matchData, maxSets) => {
    const teamAPoints = matchData.teamAPoints;
    const teamBPoints = matchData.teamBPoints;

    if (teamAPoints === teamBPoints) return alert("A set cannot end in a tie!");
    if (!window.confirm("Are you sure you want to freeze this set? The scores will be locked.")) return;

    const matchRef = doc(db, 'matches', selectedMatchId);
    const pastSets = matchData.completedSets || [];
    const currentSetNum = matchData.currentSet || 1;
    const setWinner = teamAPoints > teamBPoints ? 'A' : 'B';

    const newPastSets = [...pastSets, { teamA: teamAPoints, teamB: teamBPoints, winner: setWinner }];
    let setsWonA = 0, setsWonB = 0;
    newPastSets.forEach(set => { if (set.winner === 'A') setsWonA++; if (set.winner === 'B') setsWonB++; });

    const setsNeededToWin = Math.floor(maxSets / 2) + 1;

    if (setsWonA >= setsNeededToWin || setsWonB >= setsNeededToWin) {
      await updateDoc(matchRef, { completedSets: newPastSets, status: 'completed', winner: setsWonA >= setsNeededToWin ? matchData.teamA : matchData.teamB });
    } else {
      await updateDoc(matchRef, { completedSets: newPastSets, currentSet: currentSetNum + 1, teamAPoints: 0, teamBPoints: 0 });
    }
  };

  const handleUndoLastSet = async (matchData) => {
    if (!window.confirm("Undo the last set? This will revert the score to before it was frozen.")) return;
    
    const matchRef = doc(db, 'matches', selectedMatchId);
    const pastSets = [...(matchData.completedSets || [])];
    if (pastSets.length === 0) return;
    const lastSet = pastSets.pop(); 
    
    await updateDoc(matchRef, {
      completedSets: pastSets, currentSet: matchData.currentSet > 1 ? matchData.currentSet - 1 : 1,
      teamAPoints: lastSet.teamA, teamBPoints: lastSet.teamB, status: 'active', winner: null 
    });
  };

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
      <div className="p-4 md:p-8 bg-gray-50 min-h-[85vh] rounded-2xl">
        <h2 className="text-3xl font-black mb-8 text-gray-900 tracking-tight">Select Tournament</h2>
        {activeTournamentsList.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-3xl border border-gray-100 shadow-sm flex flex-col items-center">
            <div className="bg-gray-50 p-6 rounded-full mb-4">
              <Trophy className="text-gray-300" size={48} />
            </div>
            <h3 className="text-lg font-bold text-gray-800">No active tournaments</h3>
            <p className="text-gray-500 font-medium mt-1">Wait for an admin to start a tournament.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeTournamentsList.map(tourney => (
              <button 
                key={tourney.id} 
                onClick={() => {
                  setSelectedTournamentId(tourney.id);
                  setIsAuthorized(false); 
                  setPinCode('');
                  setPinError('');
                }} 
                className="w-full bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-left hover:border-blue-500 hover:shadow-md transition-all flex flex-col justify-between group h-full"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-xl text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">{tourney.tournamentName || 'Unnamed Tournament'}</h3>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mt-2 flex items-center">
                       {tourney.type?.replace('-', ' ')} • Best of {tourney.rules?.sets || 3}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-full group-hover:bg-blue-50 transition-colors">
                    <Lock className="text-gray-400 group-hover:text-blue-500" size={20} />
                  </div>
                </div>
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
        setPinError('Incorrect Referee Code.');
        setPinCode('');
      }
    };

    return (
      <div className="flex items-center justify-center min-h-[85vh] bg-gray-50 p-4 rounded-2xl relative">
        <button 
          onClick={() => setSelectedTournamentId(null)} 
          className="absolute top-6 left-6 text-xs text-blue-600 font-black uppercase tracking-widest flex items-center hover:text-blue-800 transition-colors"
        >
          <ChevronLeft size={16} className="mr-1" /> Back
        </button>
        
        <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-xl border border-gray-100">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-50 p-4 rounded-full">
              <ShieldAlert className="text-blue-600" size={32} />
            </div>
          </div>
          <h2 className="text-2xl font-black mb-2 text-center text-gray-900 leading-tight">{parentTournament?.tournamentName}</h2>
          <p className="text-gray-500 text-sm mb-8 text-center font-medium">Enter the 6-digit referee code to access courts.</p>
          
          <form onSubmit={handlePinSubmit} className="space-y-6">
            <div>
              <input 
                type="tel" 
                maxLength="6"
                placeholder="000000"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                className="w-full border-2 border-gray-200 p-4 rounded-2xl text-center text-4xl font-mono tracking-[0.5em] focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none text-gray-900"
                required
                autoFocus
              />
              {pinError && <p className="text-red-500 text-sm font-bold text-center mt-3 animate-pulse">{pinError}</p>}
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-black text-lg transition-colors shadow-md">
              Unlock Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER SCREEN 2: COURT SELECTION & MANAGER
  // ==========================================
  if (!selectedMatchId && isAuthorized) {
    return (
      <div className="p-4 md:p-8 bg-gray-50 min-h-[85vh] rounded-2xl pb-20">
        <button onClick={() => setSelectedTournamentId(null)} className="flex items-center text-xs font-black text-gray-500 mb-6 uppercase tracking-widest hover:text-blue-600 transition-colors">
          <ChevronLeft size={16} className="mr-1" /> Tournaments
        </button>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <div>
            <h2 className="text-2xl font-black mb-1 text-gray-900 tracking-tight">{parentTournament?.tournamentName}</h2>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest">Select Assigned Court</h3>
          </div>
          
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 w-full md:w-auto">
            {parentTournament?.allowRefereeCourtManagement && (
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                {parentTournament.type === 'knockout' ? (
                  <button onClick={handleGenerateNextRound} className="bg-purple-600 text-white px-4 py-2.5 text-sm font-bold rounded-xl shadow-sm hover:bg-purple-700 transition-colors whitespace-nowrap flex items-center justify-center">
                    <Zap size={16} className="mr-2" /> Next Round
                  </button>
                ) : (
                  <>
                    <button onClick={handleAutoResolve} className="bg-purple-600 text-white px-4 py-2.5 text-sm font-bold rounded-xl shadow-sm hover:bg-purple-700 transition-colors whitespace-nowrap flex items-center justify-center">
                      <Zap size={16} className="mr-2" /> Auto-Resolve
                    </button>
                    {completedMatches.filter(m => m.poolName === 'Knockout - Crossover').length === 2 && !tourneyMatches.find(m => m.poolName === 'Final') && (
                      <button onClick={handleCreateFinal} className="bg-yellow-500 text-white px-4 py-2.5 text-sm font-bold rounded-xl shadow-sm hover:bg-yellow-600 transition-colors whitespace-nowrap flex items-center justify-center">
                        <Trophy size={16} className="mr-2" /> Final Match
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            
            {parentTournament?.allowRefereeCustomMatches && (
              <button 
                onClick={() => setShowCustomForm(!showCustomForm)} 
                className={`px-4 py-2.5 text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center w-full sm:w-auto ${showCustomForm ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' : 'bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-700 hover:to-purple-600 hover:shadow-md'}`}
              >
                {showCustomForm ? <><XCircle size={16} className="mr-2"/> Cancel</> : <><Plus size={16} className="mr-2"/> Add Custom Match</>}
              </button>
            )}
          </div>
        </div>

        {/* 🔴 CUSTOM MATCH FORM */}
        {showCustomForm && (
          <div className="mb-8 p-6 bg-white border-2 border-purple-100 rounded-3xl shadow-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-400 to-purple-600"></div>
            <h4 className="font-black text-purple-900 mb-6 uppercase tracking-widest flex items-center">
               <Zap size={18} className="mr-2 text-purple-500" /> Create Custom Match
            </h4>
            <form onSubmit={handleCreateCustomMatch} className="space-y-5">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Match Title</label>
                <input type="text" placeholder="e.g. Exhibition, Semi-Pro" value={customForm.title} onChange={e=>setCustomForm({...customForm, title: e.target.value})} className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-purple-500 focus:ring-4 focus:ring-purple-50 transition-all outline-none font-bold" required />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Sets (Best Of)</label>
                  <input type="number" min="1" step="2" value={customForm.sets} onChange={e=>setCustomForm({...customForm, sets: e.target.value})} className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-purple-500 focus:ring-4 focus:ring-purple-50 transition-all outline-none font-bold" required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Points per Set</label>
                  <input type="number" min="1" value={customForm.points} onChange={e=>setCustomForm({...customForm, points: e.target.value})} className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-purple-500 focus:ring-4 focus:ring-purple-50 transition-all outline-none font-bold" required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Team 1 Name</label>
                  <input type="text" placeholder="Team 1" value={customForm.teamA} onChange={e=>setCustomForm({...customForm, teamA: e.target.value})} className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-purple-500 focus:ring-4 focus:ring-purple-50 transition-all outline-none font-bold" required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Team 2 Name</label>
                  <input type="text" placeholder="Team 2" value={customForm.teamB} onChange={e=>setCustomForm({...customForm, teamB: e.target.value})} className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-purple-500 focus:ring-4 focus:ring-purple-50 transition-all outline-none font-bold" required />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Assignment</label>
                <select value={customForm.courtName} onChange={e=>setCustomForm({...customForm, courtName: e.target.value})} className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-purple-500 focus:ring-4 focus:ring-purple-50 transition-all outline-none font-bold bg-white">
                  <option value="">-- Send to Pending Queue --</option>
                  {Array.from({ length: parentTournament.numCourts || 2 }).map((_, i) => (
                    <option key={i} value={`Court ${i + 1}`}>Assign directly to Court {i + 1}</option>
                  ))}
                </select>
              </div>

              <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl font-black text-lg transition-colors shadow-md mt-4 flex justify-center items-center">
                <PlayCircle className="mr-2" /> Create & Start Match
              </button>
            </form>
          </div>
        )}
        
        {/* COURTS */}
        {parentTournament?.allowRefereeCourtManagement ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            {Array.from({ length: parentTournament.numCourts || 2 }).map((_, i) => {
              const courtName = `Court ${i + 1}`;
              const matchOnCourt = activeCourts.find(m => m.courtName === courtName);

              return (
                <div key={courtName} className={`p-6 border-2 rounded-3xl transition-colors shadow-sm relative overflow-hidden flex flex-col ${matchOnCourt ? 'border-green-400 bg-white' : 'border-dashed border-gray-300 bg-gray-50/50'}`}>
                  {matchOnCourt && <div className="absolute top-0 left-0 w-full h-1.5 bg-green-400"></div>}
                  <h4 className="font-black text-gray-800 mb-4 text-lg">{courtName}</h4>
                  
                  {matchOnCourt ? (
                    <div className="flex flex-col flex-1 justify-between">
                      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-4">
                        <span className={`inline-block text-[10px] font-black px-3 py-1.5 rounded-lg mb-3 tracking-widest uppercase ${matchOnCourt.poolName === 'Final' ? 'bg-yellow-100 text-yellow-700' : matchOnCourt.poolName.includes('Round ') || matchOnCourt.poolName.includes('Knockout') ? 'bg-purple-100 text-purple-700' : matchOnCourt.isCustom ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'}`}>
                          {matchOnCourt.poolName}
                        </span>
                        <div className="flex flex-col gap-3 w-full">
                          <div className="flex items-center text-base font-bold text-gray-900">
                             <span className="w-3 h-3 rounded-full mr-3 shadow-inner flex-shrink-0" style={{ backgroundColor: parentTournament.teamColors?.[matchOnCourt.teamA] || '#2563EB' }}></span>
                             <span className="truncate">{matchOnCourt.teamA}</span>
                          </div>
                          <div className="flex items-center text-base font-bold text-gray-900">
                             <span className="w-3 h-3 rounded-full mr-3 shadow-inner flex-shrink-0" style={{ backgroundColor: parentTournament.teamColors?.[matchOnCourt.teamB] || '#2563EB' }}></span>
                             <span className="truncate">{matchOnCourt.teamB}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-auto">
                        <button onClick={() => setSelectedMatchId(matchOnCourt.id)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold transition-colors shadow-sm flex justify-center items-center">
                          Score Match <ChevronLeft size={16} className="ml-1 rotate-180" />
                        </button>
                        <button onClick={(e) => unassignMatch(matchOnCourt.id, e)} className="px-4 py-3 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl font-bold transition-colors flex justify-center items-center">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 flex-1 justify-center">
                      <select value={selectedPendingMatch[courtName] || ''} onChange={(e) => setSelectedPendingMatch(prev => ({...prev, [courtName]: e.target.value}))} className="w-full border-2 border-gray-200 p-4 rounded-xl text-sm bg-white font-bold focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition-all cursor-pointer">
                        <option value="">-- Select Match from Queue --</option>
                        {assignablePendingMatches.map(m => (
                          <option key={m.id} value={m.id}>[{m.poolName}] {m.teamA} vs {m.teamB}</option>
                        ))}
                      </select>
                      <button onClick={() => assignMatchToCourt(i)} className="bg-gray-900 hover:bg-black text-white px-4 py-4 rounded-xl font-black text-sm w-full transition-colors shadow-sm">
                        Assign to {courtName}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mb-10">
            {activeCourts.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 p-6 rounded-2xl flex items-center justify-center flex-col text-center shadow-sm">
                <Calendar className="text-yellow-400 mb-2" size={32} />
                <p className="text-yellow-800 text-lg font-bold mb-1">No matches assigned!</p>
                <p className="text-yellow-600 text-sm">Waiting for the Admin to assign matches to courts.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeCourts.map(match => (
                  <button key={match.id} onClick={() => setSelectedMatchId(match.id)} className="w-full text-left bg-white p-6 border border-gray-100 rounded-3xl shadow-sm hover:border-blue-500 hover:shadow-md transition-all group relative overflow-hidden flex flex-col">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500"></div>
                    <div className="font-black text-xl text-gray-900 mb-4">{match.courtName}</div>
                    <div className="bg-gray-50 p-4 rounded-2xl flex-1">
                      <div className={`text-[10px] font-black uppercase tracking-widest mb-3 ${match.isCustom ? 'text-purple-600' : 'text-blue-600'}`}>[{match.poolName}]</div>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center text-sm font-bold text-gray-800"><span className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: parentTournament.teamColors?.[match.teamA] || '#2563EB' }}></span>{match.teamA}</div>
                        <div className="flex items-center text-sm font-bold text-gray-800"><span className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: parentTournament.teamColors?.[match.teamB] || '#2563EB' }}></span>{match.teamB}</div>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <span className="text-blue-600 font-bold text-xs uppercase bg-blue-50 px-4 py-2 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">Open Scoreboard →</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 🔴 PENDING / COMPLETED QUEUES */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-4">Pending Queue ({pendingMatches.length})</h3>
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar divide-y divide-gray-50">
                {pendingMatches.length === 0 ? (
                  <p className="text-sm text-gray-400 p-8 text-center font-medium">No matches in queue.</p>
                ) : (
                  pendingMatches.map(m => (
                    <div key={m.id} className="p-5 hover:bg-gray-50 transition-colors">
                      <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${m.poolName === 'Final' ? 'text-yellow-600' : m.poolName.includes('Round ') || m.poolName.includes('Knockout') ? 'text-purple-600' : m.isCustom ? 'text-pink-600' : 'text-blue-600'}`}>
                        {m.poolName}
                      </div>
                      <span className="text-sm font-bold text-gray-800">{m.teamA} <span className="text-gray-400 font-normal mx-1">vs</span> {m.teamB}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-4">Completed ({completedMatches.length})</h3>
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar divide-y divide-gray-50">
                {completedMatches.length === 0 ? (
                  <p className="text-sm text-gray-400 p-8 text-center font-medium">No matches finished.</p>
                ) : (
                  completedMatches.map(m => (
                    <div key={m.id} className="p-5 hover:bg-gray-50 transition-colors flex justify-between items-center">
                      <div className="truncate pr-4">
                        <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${m.poolName === 'Final' ? 'text-yellow-600' : m.poolName.includes('Round ') || m.poolName.includes('Knockout') ? 'text-purple-600' : m.isCustom ? 'text-pink-600' : 'text-blue-600'}`}>
                          {m.poolName}
                        </div>
                        <span className="text-sm font-bold text-gray-600">{m.teamA} vs {m.teamB}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest block mb-1">Winner</span>
                        <span className="inline-flex items-center text-green-700 font-black text-xs bg-green-50 px-2.5 py-1 rounded-md">
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

  // ==========================================
  // RENDER SCREEN 3: ACTIVE SCORING UI
  // ==========================================
  if (!activeMatch) return <div className="p-4 text-center text-gray-500 font-bold">Loading match data...</div>;

  const currentMaxSets = activeMatch.customRules?.sets || parentTournament.rules?.sets || 3;
  const currentSetNum = activeMatch.currentSet || 1;
  const pastSets = activeMatch.completedSets || [];
  const isMatchCompleted = activeMatch.status === 'completed';

  const advantageTeamName = pointsA > pointsB ? activeMatch.teamA : activeMatch.teamB;
  const colorTeamA = parentTournament?.teamColors?.[activeMatch.teamA] || '#2563EB'; 
  const colorTeamB = parentTournament?.teamColors?.[activeMatch.teamB] || '#DC2626'; 

  return (
    <div className="flex flex-col min-h-[100vh] bg-gray-100 p-2 md:p-4 font-sans select-none">
      
      {/* HEADER */}
      <div className={`bg-white p-5 rounded-3xl shadow-sm mb-4 text-center relative border-b-4 flex flex-col items-center justify-center ${isMatchCompleted ? 'border-green-500' : 'border-gray-800'}`}>
        <button onClick={() => setSelectedMatchId(null)} className="absolute left-4 top-4 md:top-6 md:left-6 text-xs text-gray-500 font-black uppercase tracking-widest hover:text-gray-900 transition-colors flex items-center bg-gray-100 px-3 py-2 rounded-lg">
          <ChevronLeft size={16} className="mr-1" /> Back
        </button>
        
        <h2 className="text-2xl font-black text-gray-900 mt-8 md:mt-2 tracking-tight">{activeMatch.courtName}</h2>
        
        {isMatchCompleted ? (
          <div className="mt-3 inline-flex items-center bg-gradient-to-r from-green-400 to-green-600 text-white px-6 py-2 rounded-full font-black text-sm shadow-md uppercase tracking-widest animate-pulse">
            <Trophy size={16} className="mr-2" /> MATCH WINNER: {activeMatch.winner}
          </div>
        ) : (
          <div className="mt-2 flex flex-col items-center">
            {activeMatch.isCustom && <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mb-2 shadow-sm">Custom: {activeMatch.poolName}</span>}
            <p className="text-sm font-black text-gray-500 uppercase tracking-widest bg-gray-100 px-4 py-1.5 rounded-full">
              Set {currentSetNum} of {currentMaxSets} • Play to {targetPoints}
            </p>
          </div>
        )}
      </div>

      {/* PAST SETS */}
      {pastSets.length > 0 && (
        <div className="flex justify-center space-x-3 mb-4 overflow-x-auto pb-2 custom-scrollbar">
          {pastSets.map((set, idx) => (
            <div key={idx} className={`px-4 py-2 rounded-xl text-sm font-black whitespace-nowrap shadow-sm border-2 ${set.winner === 'A' ? 'border-blue-200 bg-white text-blue-700' : 'border-red-200 bg-white text-red-700'}`}>
              <span className="text-gray-400 text-xs mr-2">S{idx + 1}</span> {set.teamA} - {set.teamB}
            </div>
          ))}
        </div>
      )}
      
      {/* NOTIFICATIONS */}
      {!isMatchCompleted && (
        <div className="min-h-[60px] flex items-end justify-center mb-4 w-full">
          {isSetWon && (
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white w-full max-w-md p-3 rounded-2xl text-center font-black uppercase tracking-widest shadow-lg animate-bounce">
              🎉 Set Finished! Freeze it.
            </div>
          )}
          {isDeuce && !isSetWon && (
            <div className="bg-gradient-to-r from-red-600 to-red-700 text-white w-full max-w-md p-3 rounded-2xl text-center font-black uppercase tracking-widest shadow-lg animate-pulse">
              🔥 DEUCE! Win by 2 points
            </div>
          )}
          {hasAdvantage && !isSetWon && (
            <div className="bg-gradient-to-r from-yellow-400 to-yellow-500 text-yellow-900 w-full max-w-md p-3 rounded-2xl text-center font-black uppercase tracking-widest shadow-lg animate-pulse">
              ⚡ ADVANTAGE {advantageTeamName}!
            </div>
          )}
        </div>
      )}

      {/* MAIN SCORING PANELS */}
      <div className="flex-1 grid grid-cols-2 gap-3 md:gap-6">
        {/* TEAM A */}
        <div className="flex flex-col h-full">
          <div className="text-white p-4 rounded-t-3xl text-center shadow-md z-10" style={{ backgroundColor: colorTeamA }}>
            <h3 className="font-black text-lg md:text-2xl truncate tracking-tight">{activeMatch.teamA}</h3>
          </div>
          <button 
            onClick={() => updateScore('A', 1)} 
            disabled={isMatchCompleted || isSetWon} 
            className="flex-1 bg-white text-gray-900 border-x-4 flex items-center justify-center shadow-lg transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            style={{ borderColor: colorTeamA }}
          >
            <span className="text-8xl md:text-[12rem] font-black tracking-tighter">{isMatchCompleted ? '-' : activeMatch.teamAPoints}</span>
          </button>
          {!isMatchCompleted && (
            <button onClick={() => updateScore('A', -1)} className="p-6 bg-white border-x-4 border-b-4 rounded-b-3xl flex justify-center text-gray-400 hover:bg-gray-50 active:bg-gray-200 transition-colors" style={{ borderColor: colorTeamA }}>
              <Minus size={32} className="bg-gray-100 rounded-full p-1" />
            </button>
          )}
          {isMatchCompleted && <div className="h-6 bg-white border-x-4 border-b-4 rounded-b-3xl" style={{ borderColor: colorTeamA }}></div>}
        </div>

        {/* TEAM B */}
        <div className="flex flex-col h-full">
          <div className="text-white p-4 rounded-t-3xl text-center shadow-md z-10" style={{ backgroundColor: colorTeamB }}>
            <h3 className="font-black text-lg md:text-2xl truncate tracking-tight">{activeMatch.teamB}</h3>
          </div>
          <button 
            onClick={() => updateScore('B', 1)} 
            disabled={isMatchCompleted || isSetWon} 
            className="flex-1 bg-white text-gray-900 border-x-4 flex items-center justify-center shadow-lg transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            style={{ borderColor: colorTeamB }}
          >
            <span className="text-8xl md:text-[12rem] font-black tracking-tighter">{isMatchCompleted ? '-' : activeMatch.teamBPoints}</span>
          </button>
          {!isMatchCompleted && (
            <button onClick={() => updateScore('B', -1)} className="p-6 bg-white border-x-4 border-b-4 rounded-b-3xl flex justify-center text-gray-400 hover:bg-gray-50 active:bg-gray-200 transition-colors" style={{ borderColor: colorTeamB }}>
              <Minus size={32} className="bg-gray-100 rounded-full p-1" />
            </button>
          )}
          {isMatchCompleted && <div className="h-6 bg-white border-x-4 border-b-4 rounded-b-3xl" style={{ borderColor: colorTeamB }}></div>}
        </div>
      </div>

      {/* FOOTER ACTIONS */}
      <div className="mt-6 space-y-4">
        {!isMatchCompleted ? (
          <button 
            onClick={() => handleEndSet(activeMatch, currentMaxSets)} 
            className={`w-full text-white py-6 rounded-3xl font-black text-xl md:text-2xl flex items-center justify-center transition-all shadow-lg active:scale-95 ${
              isSetWon 
                ? 'bg-gradient-to-r from-green-500 to-green-600 animate-pulse border-4 border-green-200' 
                : 'bg-gray-900 hover:bg-black'
            }`}
          >
            <CheckCircle className="mr-3" size={28} /> 
            Freeze Set {currentSetNum}
          </button>
        ) : (
          <button onClick={() => setSelectedMatchId(null)} className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-6 rounded-3xl font-black text-xl active:scale-95 flex items-center justify-center shadow-lg transition-transform">
            <ChevronLeft size={24} className="mr-2" /> Back to Assigned Courts
          </button>
        )}

        {(isMatchCompleted || pastSets.length > 0) && (
          <button 
            onClick={() => handleUndoLastSet(activeMatch)} 
            className="w-full bg-white text-orange-600 py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-orange-50 active:bg-orange-100 border-2 border-orange-200 transition-colors shadow-sm"
          >
            ↺ Undo Last Frozen Set
          </button>
        )}
      </div>
    </div>
  );
}
