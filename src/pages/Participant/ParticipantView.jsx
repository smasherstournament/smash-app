import React, { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { Trophy } from 'lucide-react';

export default function ParticipantView() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    const unsubT = onSnapshot(collection(db, 'tournaments'), (snapshot) => {
      setTournaments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const unsubM = onSnapshot(query(collection(db, 'matches'), orderBy('createdAt', 'asc')), (snapshot) => {
      setMatches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => { unsubT(); unsubM(); };
  }, []);

  if (!selectedTournament) {
    return (
      <div className="p-4 bg-gray-50 min-h-screen">
        <h2 className="text-2xl font-bold mb-6">Select Tournament</h2>
        <div className="space-y-3">
          {tournaments.map(t => (
            <button key={t.id} onClick={() => setSelectedTournament(t)} className="w-full bg-white p-4 rounded-xl shadow-sm border text-left hover:border-blue-500 font-bold">
              {t.tournamentName}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const tourneyMatches = matches.filter(m => m.tournamentId === selectedTournament.id);
  
  // Group matches by category
  const pools = Array.from(new Set(tourneyMatches.map(m => m.poolName)));
  // Custom sort to ensure order: Pools -> Crossover -> Final
  const sortedPools = pools.sort((a, b) => {
    if (a === 'Final') return 1;
    if (a === 'Knockout - Crossover' && b !== 'Final') return 1;
    return -1;
  });

  return (
    <div className="p-4 bg-white min-h-screen">
      <button onClick={() => setSelectedTournament(null)} className="text-xs font-bold text-blue-600 mb-4 uppercase">← Back</button>
      <h2 className="text-2xl font-bold mb-6">{selectedTournament.tournamentName}</h2>

      {sortedPools.map((poolName) => (
        <div key={poolName} className="mb-8">
          <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-3 border-b pb-1">{poolName}</h3>
          
          <div className="overflow-x-auto border rounded-lg shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase">
                <tr>
                  <th className="p-3">Teams</th>
                  <th className="p-3 text-center">Score</th>
                  <th className="p-3 text-right">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tourneyMatches.filter(m => m.poolName === poolName).map(m => (
                  <tr key={m.id} className={m.status === 'active' ? 'bg-green-50' : ''}>
                    <td className="p-3">
                      <div className="font-bold">{m.teamA} vs {m.teamB}</div>
                      {m.courtName && <div className="text-[10px] text-gray-400 font-bold uppercase">{m.courtName}</div>}
                    </td>
                    <td className="p-3 text-center">
                       {m.status === 'active' || m.status === 'completed' ? (
                          <div className="font-mono font-bold text-blue-600">
                             {m.teamAPoints} - {m.teamBPoints}
                             <div className="text-[9px] text-gray-400 font-normal">Set {m.currentSet}</div>
                          </div>
                       ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="p-3 text-right font-bold">
                      {m.status === 'active' ? (
                        <span className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded-full animate-pulse uppercase">Live</span>
                      ) : m.status === 'completed' ? (
                        <span className="flex items-center justify-end text-green-700">
                          {m.winner} <Trophy size={14} className="ml-1" />
                        </span>
                      ) : (
                        <span className="text-gray-300 italic font-normal text-xs">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}