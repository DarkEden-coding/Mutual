import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { EventPage } from './pages/EventPage';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';

// Dev-only theme kitchen sink; tree-shaken out of production builds.
const KitchenSink = import.meta.env.DEV ? lazy(() => import('./pages/KitchenSink').then((m) => ({ default: m.KitchenSink }))) : null;

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="e/:id" element={<EventPage />} />
            {KitchenSink && (
              <Route
                path="themes"
                element={
                  <Suspense fallback={null}>
                    <KitchenSink />
                  </Suspense>
                }
              />
            )}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
