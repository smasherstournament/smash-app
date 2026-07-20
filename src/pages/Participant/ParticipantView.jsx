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
    const activeTournaments = tournaments.filter(t => t.status !== 'archived');

    return (
      <div className="p-4 bg-gray-50 min-h-[85vh] rounded-xl transition-colors">
        <h2 className="text-2xl font-bold mb-6 text-gray-900">Live Tournaments</h2>
        
        {activeTournaments.length === 0 ? (
          <div className="text-center p-8 bg-white rounded-xl border shadow-sm">
            <Trophy className="mx-auto text-gray-300 mb-3" size={48} />
            <p className="text-gray-500 font-medium">No live tournaments right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeTournaments.map(t => (
              <button 
                key={t.id} 
                onClick={() => setSelectedTournament(t)} 
                className="w-full bg-white p-5 rounded-xl shadow-sm border text-left hover:border-blue-500 transition-all flex justify-between items-center group"
              >
                <div>
                  <h3 className="font-bold text-lg text-gray-900 group-hover:text-blue-600 transition-colors">{t.tournamentName}</h3>
                  <p className="text-xs text-gray-500 capitalize mt-1">{t.type?.replace('-', ' ')}</p>
                </div>
                <div className="bg-blue-50 text-blue-600 text-xs font-bold px-3 py-1.5 rounded-lg uppercase tracking-wider">
                  View →
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const tourneyMatches = matches.filter(m => m.tournamentId === selectedTournament.id);
  
  // Group matches by category
  const pools = Array.from(new Set(tourneyMatches.map(m => m.poolName)));
  
  const sortedPools = pools.sort((a, b) => {
    if (a.includes('Round') && b.includes('Round')) return a.localeCompare(b);
    if (a === 'Final') return 1;
    if (b === 'Final') return -1;
    if (a === 'Knockout - Crossover' && b !== 'Final') return 1;
    return -1;
  });

  const getTeamColor = (teamName) => {
    if (!teamName || teamName === 'BYE') return '#9CA3AF';
    return selectedTournament.teamColors?.[teamName] || '#3B82F6';
  };

  return (
    <div className="p-4 bg-white min-h-[85vh] rounded-xl transition-colors pb-12">
      <button 
        onClick={() => setSelectedTournament(null)} 
        className="text-xs font-bold text-blue-600 mb-4 uppercase hover:underline"
      >
        ← Back to Tournaments
      </button>
      <h2 className="text-2xl font-black mb-8 text-gray-900">{selectedTournament.tournamentName}</h2>

      {/* Standard List View */}
      <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest mb-4">Detailed Match List</h3>
      
      {sortedPools.map((poolName) => (
        <div key={poolName} className="mb-8">
          <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3 border-b pb-2">{poolName}</h4>
          
          <div className="overflow-x-auto border rounded-lg shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="p-3">Teams</th>
                  <th className="p-3 text-center">Score</th>
                  <th className="p-3 text-right">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {tourneyMatches.filter(m => m.poolName === poolName).map(m => (
                  <tr key={m.id} className={m.status === 'active' ? 'bg-green-50' : 'hover:bg-gray-50 transition-colors'}>
                    <td className="p-3">
                      <div className="font-bold text-gray-900 flex items-center mb-1">
                        <span className="w-2 h-2 rounded-full mr-1.5 inline-block flex-shrink-0" style={{ backgroundColor: getTeamColor(m.teamA) }}></span>
                        <span className="truncate">{m.teamA}</span>
                      </div>
                      <div className="text-xs text-gray-500">vs</div>
                      <div className="font-bold text-gray-900 flex items-center mt-1">
                        {m.teamB !== 'BYE' && <span className="w-2 h-2 rounded-full mr-1.5 inline-block flex-shrink-0" style={{ backgroundColor: getTeamColor(m.teamB) }}></span>}
                        <span className="truncate">{m.teamB}</span>
                      </div>
                      {m.courtName && <div className="text-[10px] text-blue-600 font-bold uppercase mt-2">{m.courtName}</div>}
                    </td>
                    
                    <td className="p-3 text-center align-middle">
                       {m.status === 'active' || m.status === 'completed' ? (
                          <div>
                            <div className="font-mono font-black text-lg text-blue-600 tracking-wider">
                               {m.teamAPoints} - {m.teamBPoints}
                            </div>
                            <div className="text-[9px] text-gray-400 font-bold uppercase mt-1">Set {m.currentSet}</div>
                          </div>
                       ) : <span className="text-gray-300 font-bold">-</span>}
                    </td>
                    
                    <td className="p-3 text-right align-middle">
                      {m.status === 'active' ? (
                        <div className="flex justify-end">
                          <span className="text-[10px] font-bold bg-green-600 text-white px-2 py-1 rounded animate-pulse uppercase tracking-wider">Live</span>
                        </div>
                      ) : m.status === 'completed' ? (
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] text-gray-500 uppercase font-bold mb-1">Winner</span>
                          <span className="flex items-center text-green-700 font-bold text-xs">
                            {m.winner} <Trophy size={14} className="ml-1.5" />
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400 italic font-medium text-xs">Pending</span>
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
