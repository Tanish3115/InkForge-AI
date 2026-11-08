import { lazy, Suspense, useEffect, useState } from "react";
import Landing from "./components/Landing";
const Studio = lazy(() => import("./components/Studio"));
export default function App() {
  const [studio, setStudio] = useState(location.hash === "#studio");
  useEffect(() => {
    const update = () => setStudio(location.hash === "#studio");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return studio ? (
    <Suspense
      fallback={<div className="loading-app">Opening your writing studio…</div>}
    >
      <Studio
        onHome={() => {
          location.hash = "";
        }}
      />
    </Suspense>
  ) : (
    <Landing
      onLaunch={() => {
        location.hash = "studio";
      }}
    />
  );
}
