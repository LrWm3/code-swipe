import type { AppState, ExecutionEnvironment } from '../src/types.ts';
import { PYTHON_IMAGE } from './python-runtime.ts';
import { RUST_IMAGE } from './rust-runtime.ts';

export function executionEnvironments(statuses: NonNullable<AppState['languages']> = []): ExecutionEnvironment[] {
  return [
    { id: 'javascript' as const, name: 'JavaScript sandbox', version: 'QuickJS WASM', contextIds: ['javascript'], capabilities: ['Pure synchronous functions', 'JSON-compatible arguments and results'], restrictions: ['No modules, network, filesystem, or host APIs'], available: true, detail: 'JavaScript sandbox ready.' },
    { id: 'python' as const, name: 'Python sandbox', version: PYTHON_IMAGE, contextIds: ['python'], capabilities: ['Pure synchronous functions', 'math, typing, collections, itertools, functools, re'], restrictions: ['No third-party packages, network, filesystem, or input mutation'], available: false, detail: 'Python sandbox unavailable.' },
    { id: 'rust' as const, name: 'Rust sandbox', version: RUST_IMAGE, contextIds: ['rust'], capabilities: ['Pure synchronous functions', 'Supported scalars, strings, vectors, slices, Option, Result, and maps'], restrictions: ['No third-party packages, custom fixture structs, or mutable-reference inputs', 'Candidate and reference must compile'], available: false, detail: 'Rust sandbox unavailable.' },
  ].map(environment => ({ ...environment, ...statuses.find(status => status.id === environment.id), contextIds: environment.contextIds }));
}

