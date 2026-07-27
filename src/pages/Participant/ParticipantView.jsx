import React, { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { Trophy, ChevronLeft, Calendar, Activity, Crown } from 'lucide-react';

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
      <div className="p-4 bg-gray-50 min-h-[85vh] rounded-2xl transition-colors">
        <h2 className="text-3xl font-black mb-8 text-gray-900 tracking-tight">Live Tournaments</h2>
        
        {activeTournaments.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-3xl border border-gray-100 shadow-sm flex flex-col items-center">
            <div className="bg-gray-50 p-6 rounded-full mb-4">
              <Trophy className="text-gray-300" size={48} />
            </div>
            <h3 className="text-lg font-bold text-gray-800">No active tournaments</h3>
            <p className="text-gray-500 font-medium mt-1">Check back later for live action!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeTournaments.map(t => (
              <button 
                key={t.id} 
                onClick={() => setSelectedTournament(t)} 
                className="w-full bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-left hover:border-blue-500 hover:shadow-md transition-all flex flex-col justify-between group h-full"
              >
                <div className="mb-4">
                  <h3 className="font-bold text-xl text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">{t.tournamentName}</h3>
                  <div className="flex items-center text-xs text-gray-500 font-bold uppercase tracking-wider mt-2">
                    <Activity size={14} className="mr-1.5 text-blue-500" />
                    {t.type?.replace('-', ' ')}
                  </div>
                </div>
                <div className="flex justify-between items-center w-full border-t pt-4">
                  <span className="text-xs font-bold text-gray-400">{t.numTeams} Teams</span>
                  <div className="bg-blue-50 text-blue-600 text-xs font-bold px-4 py-2 rounded-xl uppercase tracking-wider group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    View Action →
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const tourneyMatches = matches.filter(m => m.tournamentId === selectedTournament.id);
  
  // ==========================================
  // POOL & STANDINGS LOGIC (Brought from Admin)
  // ==========================================
  const standardPools = Object.keys(selectedTournament?.pools || {});
  const allMatchPools = Array.from(new Set(tourneyMatches.map(m => m.poolName)));
  
  const customPools = allMatchPools.filter(p => 
    !standardPools.includes(p) && 
    p !== 'Knockout - Crossover' && 
    p !== 'Final' &&
    !p.startsWith('Round ')
  );

  const allDisplayPools = [...standardPools, ...customPools];
  const hasCrossovers = tourneyMatches.some(m => m.poolName === 'Knockout - Crossover');
  const hasFinal = tourneyMatches.some(m => m.poolName === 'Final');
  
  if (hasCrossovers) allDisplayPools.push('Knockout - Crossover');
  if (hasFinal) allDisplayPools.push('Final');

  const finalMatch = tourneyMatches.find(m => m.poolName === 'Final' && m.status === 'completed');
  const champion = finalMatch ? finalMatch.winner : null;

  const getPoolStandings = (poolName) => {
    const targetMatches = selectedTournament?.type === 'knockout' 
      ? tourneyMatches
      : tourneyMatches.filter(m => m.poolName === poolName);
    
    let teamNames = selectedTournament?.pools?.[poolName] || [];
    if (teamNames.length === 0) {
      const uniqueTeams = new Set();
      targetMatches.forEach(m => {
        if (m.teamA) uniqueTeams.add(m.teamA);
        if (m.teamB && m.teamB !== 'BYE') uniqueTeams.add(m.teamB);
      });
      teamNames = Array.from(uniqueTeams);
    }

    let stats = teamNames.map(t => ({ team: t, won: 0, losses: 0, setsWon: 0, pointsFor: 0, pointsAgainst: 0 }));
    
    const completedMatches = targetMatches.filter(m => m.status === 'completed');
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

  const sortedMatchPools = allMatchPools.sort((a, b) => {
    if (a.includes('Round') && b.includes('Round')) return a.localeCompare(b);
    if (a === 'Final') return 1;
    if (b === 'Final') return -1;
    if (a === 'Knockout - Crossover' && b !== 'Final') return 1;
    return a.localeCompare(b); 
  });

  const getTeamColor = (teamName) => {
    if (!teamName || teamName === 'BYE') return '#9CA3AF';
    return selectedTournament.teamColors?.[teamName] || '#3B82F6';
  };

  return (
    <div className="p-4 md:p-8 bg-gray-50 min-h-[85vh] rounded-2xl pb-20">
      <button 
        onClick={() => setSelectedTournament(null)} 
        className="flex items-center text-xs font-black text-gray-500 mb-6 uppercase tracking-widest hover:text-blue-600 transition-colors"
      >
        <ChevronLeft size={16} className="mr-1" /> All Tournaments
      </button>

      {/* 🔴 MASSIVE CHAMPION BANNER */}
      {champion ? (
        <div className="mb-10 bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-500 rounded-3xl p-8 md:p-12 text-center shadow-xl border-4 border-yellow-100 relative overflow-hidden flex flex-col items-center">
          {/* Subtle background glow */}
          <div className="absolute top-0 left-0 w-full h-full bg-white opacity-20 animate-pulse mix-blend-overlay pointer-events-none"></div>
          
          <div className="bg-white p-4 rounded-full shadow-lg mb-4 z-10 animate-bounce">
            <Trophy size={48} className="text-yellow-500" />
          </div>
          <h2 className="text-xs md:text-sm font-black text-yellow-900 uppercase tracking-[0.3em] mb-2 z-10 opacity-80">
            Tournament Champion
          </h2>
          <h1 className="text-4xl md:text-6xl font-black text-gray-900 drop-shadow-md z-10 tracking-tight">
            {champion}
          </h1>
        </div>
      ) : (
        <h2 className="text-3xl md:text-4xl font-black mb-8 text-gray-900 tracking-tight">{selectedTournament.tournamentName}</h2>
      )}

      {/* 🔴 LIVE STANDINGS (Copied and Beautified from Admin) */}
      <div className="mb-12">
        <div className="flex items-center mb-6">
          <div className="bg-blue-100 p-2 rounded-lg mr-3">
            <Trophy size={20} className="text-blue-600" />
          </div>
          <h3 className="text-xl font-black text-gray-800 uppercase tracking-wide">
            {selectedTournament.type === 'knockout' ? 'Live Tournament Standings' : 'Live Standings'}
          </h3>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {allDisplayPools.map(poolName => {
            const standings = getPoolStandings(poolName);
            if (standings.length === 0) return null;
            const isKnockout = selectedTournament.type === 'knockout';

            // Determine Header Color
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
                        const isWinner = (poolName === 'Final' && idx === 0 && stat.won > 0) || (isKnockout && stat.team === champion);
                        const isEliminated = isKnockout && stat.losses > 0;
                        const isPoolQualifier = standardPools.includes(poolName) && idx < selectedTournament.rules.tableTops;
                        
                        return (
                          <tr key={stat.team} className={`transition-colors hover:bg-gray-50 ${isWinner ? "bg-yellow-50/50" : isPoolQualifier ? "bg-green-50/30" : ""}`}>
                            <td className={`px-4 py-3 font-bold flex items-center ${isEliminated ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                              <span className="w-3 h-3 rounded-full mr-3 shadow-inner" style={{ backgroundColor: getTeamColor(stat.team) }}></span>
                              {stat.team} 
                              {isWinner && <Crown size={14} className="ml-2 text-yellow-500" />}
                            </td>
                            <td className="px-3 py-3 text-center font-black text-gray-900">{stat.won}</td>
                            <td className="px-3 py-3 text-center font-semibold text-gray-500">{stat.setsWon}</td>
                            <td className="px-3 py-3 text-center font-black text-red-500">{stat.losses}</td>
                            
                            {isKnockout && (
                              <td className={`px-3 py-3 text-center font-bold text-xs ${isEliminated ? 'text-red-400' : 'text-green-500'}`}>
                                {isEliminated ? 'OUT' : 'IN'}
                              </td>
                            )}

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

      {/* 🔴 BEAUTIFIED DETAILED MATCH LIST */}
      <div>
        <div className="flex items-center mb-6">
          <div className="bg-gray-200 p-2 rounded-lg mr-3">
            <Calendar size={20} className="text-gray-600" />
          </div>
          <h3 className="text-xl font-black text-gray-800 uppercase tracking-wide">Match Schedule & Results</h3>
        </div>
        
        <div className="space-y-8">
          {sortedMatchPools.map((poolName) => {
            const poolMatches = tourneyMatches.filter(m => m.poolName === poolName);
            if (poolMatches.length === 0) return null;

            return (
              <div key={poolName} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-1">
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <h4 className={`text-xs font-black uppercase tracking-widest ${customPools.includes(poolName) ? 'text-pink-600' : 'text-gray-500'}`}>
                    {poolName} {customPools.includes(poolName) && '⭐'}
                  </h4>
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-md">{poolMatches.length} Matches</span>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <tbody className="divide-y divide-gray-50">
                      {poolMatches.map(m => (
                        <tr key={m.id} className={`transition-colors ${m.status === 'active' ? 'bg-blue-50/30' : 'hover:bg-gray-50'}`}>
                          
                          {/* Teams Col */}
                          <td className="p-4 w-1/2">
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center">
                                <span className="w-2.5 h-2.5 rounded-full mr-3 shadow-inner" style={{ backgroundColor: getTeamColor(m.teamA) }}></span>
                                <span className={`font-bold text-base ${m.winner === m.teamA ? 'text-gray-900' : m.status === 'completed' ? 'text-gray-500' : 'text-gray-800'}`}>
                                  {m.teamA} {m.winner === m.teamA && <Trophy size={14} className="inline ml-1.5 text-yellow-500" />}
                                </span>
                              </div>
                              <div className="flex items-center">
                                {m.teamB !== 'BYE' && <span className="w-2.5 h-2.5 rounded-full mr-3 shadow-inner" style={{ backgroundColor: getTeamColor(m.teamB) }}></span>}
                                <span className={`font-bold text-base ${m.winner === m.teamB ? 'text-gray-900' : m.status === 'completed' ? 'text-gray-500' : 'text-gray-800'}`}>
                                  {m.teamB} {m.winner === m.teamB && <Trophy size={14} className="inline ml-1.5 text-yellow-500" />}
                                </span>
                              </div>
                            </div>
                            {m.courtName && (
                              <div className="mt-3 inline-block bg-gray-100 text-gray-500 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded">
                                {m.courtName}
                              </div>
                            )}
                          </td>
                          
                          {/* Score Col */}
                          <td className="p-4 text-center align-middle border-l border-r border-gray-50 bg-gray-50/30 w-1/4">
                             {m.status === 'active' || m.status === 'completed' ? (
                                <div className="flex flex-col items-center justify-center">
                                  <div className="font-mono font-black text-2xl tracking-widest text-gray-800">
                                     <span className={m.winner === m.teamA ? 'text-blue-600' : ''}>{m.teamAPoints}</span>
                                     <span className="mx-2 text-gray-300">-</span>
                                     <span className={m.winner === m.teamB ? 'text-blue-600' : ''}>{m.teamBPoints}</span>
                                  </div>
                                  <div className="text-[10px] text-gray-400 font-bold uppercase mt-1 tracking-widest">
                                    {m.status === 'completed' ? 'Final' : `Set ${m.currentSet}`}
                                  </div>
                                </div>
                             ) : (
                               <span className="text-gray-300 font-black text-xl">-</span>
                             )}
                          </td>
                          
                          {/* Status Col */}
                          <td className="p-4 text-right align-middle w-1/4">
                            {m.status === 'active' ? (
                              <div className="inline-flex items-center bg-red-100 text-red-600 px-3 py-1.5 rounded-lg">
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-ping mr-2"></div>
                                <span className="text-[10px] font-black uppercase tracking-widest">Live Now</span>
                              </div>
                            ) : m.status === 'completed' ? (
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] text-gray-400 uppercase font-black tracking-widest mb-1">Winner</span>
                                <span className="inline-block bg-green-100 text-green-800 font-black text-xs px-3 py-1.5 rounded-lg truncate max-w-[120px]">
                                  {m.winner}
                                </span>
                              </div>
                            ) : (
                              <span className="inline-block bg-gray-100 text-gray-400 font-bold text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-lg">
                                Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
