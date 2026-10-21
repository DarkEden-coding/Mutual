import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { EventPage } from './pages/EventPage';
import { Home } from './pages/Home';
import { NewEvent } from './pages/NewEvent';
import { NotFound } from './pages/NotFound';

// Dev-only theme kitchen sink; tree-shaken out of production builds.
const KitchenSink = import.meta.env.DEV ? lazy(() => import('./pages/KitchenSink').then((m) => ({ default: m.KitchenSink }))) : null;

// Lazy so regular visitors never download the dashboard (or its stylesheet).
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="new" element={<NewEvent />} />
            <Route path="e/:id" element={<EventPage />} />
            <Route
              path="admin"
              element={
                <Suspense fallback={null}>
                  <Admin />
                </Suspense>
              }
            />
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
