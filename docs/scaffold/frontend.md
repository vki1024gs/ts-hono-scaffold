# Frontend component decisions

The base application intentionally uses native React controls and does not install a component library. Choose a UI system from the product surface being built, not from the size of the first screen.

## Prefer Ant Design

Use Ant Design for application-style interfaces such as dashboards, administration tools and local service managers when the work needs several standard interaction patterns: data tables, filters, pagination, validated forms, drawers or modals, notifications, menus, tabs, date selection, loading states or destructive-action confirmation.

Once the application adopts Ant Design, reuse its components and tokens for equivalent controls instead of maintaining parallel hand-built buttons, dialogs, tables or form behavior. Keep business API calls in `packages/frontend/src/api`; a UI library does not change the contract boundary.

## Prefer native or custom UI

Native controls and project CSS remain appropriate for a small focused screen, content-heavy page, brand-led landing surface, or an interface whose visual system materially differs from Ant Design. Do not add Ant Design for one incidental button or replace accessible working controls without a product reason.

## Adoption checklist

1. Read `docs/scaffold/recipes/README.md` and use the Ant Design example matching the recorded scaffold version.
2. Add Ant Design to the frontend package's runtime `dependencies`, never the root package or `devDependencies`.
3. Define theme tokens centrally and preserve keyboard behavior, visible focus, responsive layouts, loading, empty, error and retry states.
4. Test the actual workflows at narrow and normal widths. Run `pnpm verify` and inspect the production bundle before handoff.
5. Record the adopted dependency version, affected pages, theme decisions and validation evidence in the application's current architecture or status document.

The inherited recipe is a starting example, not an automatic migration or a permanent source of truth after the application has adopted and changed it.
