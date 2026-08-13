import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data = {
    alive: true,
    config,
    env: __env__,
    initialized: false,
    ztoolkit: createZToolkit(),
  };
  public hooks = hooks;
  public api = {};
}

export default Addon;
