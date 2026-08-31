import { log } from "../src/log.ts";

// Silence the logger in tests; behavior is unchanged.
log.level = "silent";
