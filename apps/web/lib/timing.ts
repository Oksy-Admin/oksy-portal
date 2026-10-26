// Timing log (S0): one server log line per step, name and milliseconds only.
// Never logs parameters, rows or user data (hard rule 10: no patient data in logs).
export function logTiming(label: string, startedAt: number) {
  console.info(`[timing] ${label} ${Math.round(performance.now() - startedAt)}ms`);
}

export async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    logTiming(label, startedAt);
  }
}

// Wraps a page's default export so its server work is logged as "page <route>".
export function withTiming<P>(route: string, Page: (props: P) => Promise<React.ReactNode>) {
  return function TimedPage(props: P) {
    return timed(`page ${route}`, () => Page(props));
  };
}
