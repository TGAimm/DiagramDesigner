// The worker lines are routed in (see route-client.ts), loaded with Vite's `?worker`.
import { routeService, type FromRouter, type ToRouter } from './route-service.ts';

const scope = self as unknown as {
	postMessage(m: FromRouter): void;
	onmessage: ((e: MessageEvent<ToRouter>) => void) | null;
};
const serve = routeService((m) => scope.postMessage(m));
scope.onmessage = (e) => void serve(e.data);
