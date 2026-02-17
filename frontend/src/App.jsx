import { Routes, Route } from "react-router-dom";
import Desktop from "./pages/Desktop";
import Mobile from "./pages/Mobile";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Desktop />} />
      <Route path="/room/:roomCode" element={<Desktop />} />
      <Route path="/mobile" element={<Mobile />} />
      <Route path="/mobile/:roomCode" element={<Mobile />} />
    </Routes>
  );
}
