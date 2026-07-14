import React, { useState, useEffect } from 'react';
import { Minus, CheckCircle, Trophy, Lock } from 'lucide-react';
import { db } from '../../config/firebase';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';

export default function RefereeView() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  
  // --- NEW AUTH STATE ---
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [pinError, setPinError] = useState('');

  const [matches, setMatches] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState(null);

  // 1. Listen for active tournaments and matches
  useEffect(() => {
    const unsubTournaments = onSnapshot(collection(db, 'tournaments'), (snapshot) => {
      setTournaments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubMatches = onSnapshot(collection(db, 'matches'), (snapshot) => {
      setMatches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => { unsubTournaments(); unsubMatches(); };
  }, []);

  // 2. Score and Match Logic
  const updateScore = async (team, increment) => {
    const match = matches.find(m => m.id === selectedMatchId);
    if (!match || match.status === 'completed') return;

    const currentScore = match[team === 'A' ? 'teamAPoints' : 'teamBPoints'];
    const newScore = Math.max(0, currentScore + increment);

    const matchRef = doc(db, 'matches', selectedMatchId);
    await updateDoc(matchRef, {
      [team === 'A' ? 'teamAPoints' : 'teamBPoints']: newScore
    });
  };

  const handleEndSet = async (activeMatch, maxSets) => {
    const teamAPoints = activeMatch.teamAPoints;
    const teamBPoints = activeMatch.teamBPoints;

    if (teamAPoints === teamBPoints) {
      alert("A set cannot end in a tie!");
      return;
    }

    if (!window.confirm("Are you sure you want to freeze this set? The scores will be locked.")) return;

    const matchRef = doc(db, 'matches', selectedMatchId);
    const pastSets = activeMatch.completedSets || [];
    const currentSetNum = activeMatch.currentSet || 1;

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
      const matchWinnerName = setsWonA >= setsNeededToWin ? activeMatch.teamA : activeMatch.teamB;
      
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

  // ==========================================
  // RENDER SCREEN 1: TOURNAMENT SELECTION
  // ==========================================
  if (!selectedTournamentId) {
    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[60vh]">
        <h2 className="text-2xl font-bold mb-4">Select Tournament</h2>
        {tournaments.length === 0 ? (
          <p className="text-gray-500 italic">No active tournaments available.</p>
        ) : (
          <div className="space-y-3">
            {tournaments.map(tourney => (
              <button 
                key={tourney.id} 
                onClick={() => {
                  setSelectedTournamentId(tourney.id);
                  setIsAuthorized(false); // Reset auth when picking a new tournament
                  setPinCode('');
                  setPinError('');
                }} 
                className="w-full text-left p-4 border-2 border-gray-100 rounded-xl hover:border-blue-500 active:bg-blue-50 transition-all flex justify-between items-center"
              >
                <div>
                  <div className="font-bold text-lg text-gray-800">{tourney.tournamentName || 'Unnamed Tournament'}</div>
                  <div className="text-sm text-gray-500 capitalize">{tourney.type?.replace('-', ' ')} • Best of {tourney.rules?.sets}</div>
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
  // RENDER SCREEN 1.5: PIN CODE ENTRY (NEW)
  // ==========================================
  const parentTournament = tournaments.find(t => t.id === selectedTournamentId);

  if (selectedTournamentId && !isAuthorized) {
    const handlePinSubmit = (e) => {
      e.preventDefault();
      // Bypass if no code was set on old tournaments, otherwise check code
      if (!parentTournament.refereeCode || pinCode === parentTournament.refereeCode) {
        setIsAuthorized(true);
        setPinError('');
      } else {
        setPinError('Incorrect Referee Code. Please ask the Admin.');
        setPinCode('');
      }
    };

    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[60vh] flex flex-col justify-center items-center">
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
    // Only show active matches that have been assigned a court by the Admin
    const activeCourts = matches.filter(m => m.tournamentId === selectedTournamentId && m.status === 'active');
    
    return (
      <div className="p-4 bg-white rounded-xl shadow-sm min-h-[60vh]">
        <button onClick={() => setSelectedTournamentId(null)} className="text-xs text-blue-600 font-bold uppercase mb-4 block">← Back to Tournaments</button>
        <h2 className="text-xl font-bold mb-1 text-gray-800">{parentTournament?.tournamentName}</h2>
        <h3 className="text-md font-semibold text-gray-500 mb-4">Select Assigned Court</h3>
        
        {activeCourts.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
            <p className="text-yellow-700 text-sm font-bold mb-1">No matches assigned!</p>
            <p className="text-yellow-600 text-xs">Waiting for Admin to assign matches to courts.</p>
          </div>
        ) : (
          <div className="space-y-3">
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
    );
  }

  // ==========================================
  // RENDER SCREEN 3: ACTIVE SCORING UI
  // ==========================================
  const activeMatch = matches.find(m => m.id === selectedMatchId);
  if (!activeMatch) return <div className="p-4 text-center">Loading match data...</div>;

  const maxSets = parentTournament.rules?.sets || 3;
  const currentSetNum = activeMatch.currentSet || 1;
  const pastSets = activeMatch.completedSets || [];
  const isMatchCompleted = activeMatch.status === 'completed';

  return (
    <div className="flex flex-col min-h-[85vh] bg-gray-50 p-2 rounded-xl">
      <div className={`bg-white p-4 rounded-xl shadow-sm mb-4 text-center relative border-b-4 ${isMatchCompleted ? 'border-green-500' : 'border-blue-600'}`}>
        <button onClick={() => setSelectedMatchId(null)} className="absolute left-4 top-4 text-sm text-blue-600 font-semibold">← Courts</button>
        <h2 className="text-xl font-bold text-gray-800 mt-6">{activeMatch.courtName}</h2>
        
        {isMatchCompleted ? (
          <div className="mt-2 inline-flex items-center bg-green-100 text-green-800 px-4 py-1 rounded-full font-bold text-sm">
            <Trophy size={16} className="mr-2" />
            WINNER: {activeMatch.winner}
          </div>
        ) : (
          <p className="text-sm font-bold text-gray-500 uppercase mt-1">
            Set {currentSetNum} of {maxSets}
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

      <div className="flex-1 grid grid-cols-2 gap-4">
        <div className="flex flex-col space-y-3">
          <div className="bg-blue-600 text-white p-3 rounded-t-xl text-center">
            <h3 className="font-semibold text-base truncate">{activeMatch.teamA}</h3>
          </div>
          <button onClick={() => updateScore('A', 1)} disabled={isMatchCompleted} className="flex-1 bg-blue-100 active:bg-blue-200 text-blue-700 rounded-xl flex items-center justify-center shadow-inner transition-colors min-h-[160px] disabled:opacity-50">
            <span className="text-7xl font-bold">{isMatchCompleted ? '-' : activeMatch.teamAPoints}</span>
          </button>
          <button onClick={() => updateScore('A', -1)} disabled={isMatchCompleted} className="p-4 bg-white border-2 border-gray-200 rounded-b-xl flex justify-center text-gray-600 active:bg-gray-100 disabled:opacity-50">
            <Minus size={24} />
          </button>
        </div>

        <div className="flex flex-col space-y-3">
          <div className="bg-red-600 text-white p-3 rounded-t-xl text-center">
            <h3 className="font-semibold text-base truncate">{activeMatch.teamB}</h3>
          </div>
          <button onClick={() => updateScore('B', 1)} disabled={isMatchCompleted} className="flex-1 bg-red-100 active:bg-red-200 text-red-700 rounded-xl flex items-center justify-center shadow-inner transition-colors min-h-[160px] disabled:opacity-50">
            <span className="text-7xl font-bold">{isMatchCompleted ? '-' : activeMatch.teamBPoints}</span>
          </button>
          <button onClick={() => updateScore('B', -1)} disabled={isMatchCompleted} className="p-4 bg-white border-2 border-gray-200 rounded-b-xl flex justify-center text-gray-600 active:bg-gray-100 disabled:opacity-50">
            <Minus size={24} />
          </button>
        </div>
      </div>

      {!isMatchCompleted && (
        <button onClick={() => handleEndSet(activeMatch, maxSets)} className="mt-6 w-full bg-gray-800 text-white py-4 rounded-xl font-bold text-lg active:bg-gray-700 flex items-center justify-center">
          <CheckCircle className="mr-2" /> 
          Freeze Set {currentSetNum}
        </button>
      )}
    </div>
  );
}