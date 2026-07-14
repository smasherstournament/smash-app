import React from 'react';
import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import ParticipantView from './pages/Participant/ParticipantView';
import RefereeView from './pages/Referee/RefereeView';
import AdminView from './pages/Admin/AdminView';

function App() {
  return (
    <HashRouter>
      <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
        {/* Navigation Bar */}
        <nav className="bg-blue-600 text-white p-4 shadow-md flex justify-between items-center">
          <h1 className="font-bold text-lg">Badminton Live</h1>
          <div className="space-x-4 text-sm font-medium">
            <Link to="/" className="hover:underline">Scores</Link>
            <Link to="/referee" className="hover:underline">Referee</Link>
            <Link to="/admin" className="hover:underline">Admin</Link>
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