import { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
const routes = [
  {
    path: '/',
    label: 'Items',
    component: lazy(() =>
      import('./pages/HomePage').then((module) => ({
        default: module.HomePage,
      })),
    ),
  },
];
export class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section role="alert">
        <h1>This page could not load</h1>
        <p>Try reloading the page.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
        <p>
          <Link href="/">Return home</Link>
        </p>
      </section>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  const [location] = useLocation();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header>
        <strong>{import.meta.env.VITE_APP_TITLE || 'my-project'}</strong>
        <nav aria-label="Main navigation">
          {routes.map((route) => (
            <Link
              key={route.path}
              href={route.path}
              aria-current={location === route.path ? 'page' : undefined}
            >
              {route.label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main">
        <PageBoundary key={location}>
          <Suspense fallback={<p role="status">Loading page…</p>}>
            <Switch>
              {routes.map((route) => (
                <Route
                  key={route.path}
                  path={route.path}
                  component={route.component}
                />
              ))}
              <Route>
                <h1>Page not found</h1>
                <Link href="/">Return home</Link>
              </Route>
            </Switch>
          </Suspense>
        </PageBoundary>
      </main>
      <footer>Local workspace · Memory storage</footer>
    </>
  );
}
