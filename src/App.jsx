import React from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import ParticipantView from './pages/Participant/ParticipantView';
import RefereeView from './pages/Referee/RefereeView';
import AdminView from './pages/Admin/AdminView';

function App() {
  // Helper function to style links based on active state
  const getLinkClass = ({ isActive }) => 
    `hover:underline px-3 py-1.5 rounded transition-all ${
      isActive ? 'bg-blue-800 text-white shadow-inner font-bold' : 'text-blue-100 hover:text-white'
    }`;

  return (
    <HashRouter>
      <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
        {/* Navigation Bar */}
        <nav className="bg-blue-600 text-white p-4 shadow-md flex justify-between items-center">
          <h1 className="font-bold text-lg tracking-tight">Badminton Live</h1>
          <div className="flex space-x-2 text-sm font-medium">
            <NavLink 
              to="/" 
              end
              className={getLinkClass}
            >
              Scores
            </NavLink>
            <NavLink 
              to="/referee" 
              className={getLinkClass}
            >
              Referee
            </NavLink>
            <NavLink 
              to="/admin" 
              className={getLinkClass}
            >
              Admin
            </NavLink>
          </div>
        </nav>

        {/* Page Content */}
        <main className="container mx-auto max-w-md md:max-w-4xl p-2 mt-4">
          <Routes>
            <Route path="/" element={<ParticipantView />} />
            <Route path="/referee" element={<RefereeView />} />
            <Route path="/admin" element={<AdminView />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

export default App;
