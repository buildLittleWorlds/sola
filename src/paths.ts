// Resolve a root-relative public path (e.g. '/corpus/GEN.json') against the deployed base ('/sola/' on Pages).
export const appPath = (path: string): string => import.meta.env.BASE_URL + path.replace(/^\/+/, '');
