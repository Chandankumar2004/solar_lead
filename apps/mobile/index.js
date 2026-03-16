import { registerRootComponent } from "expo";
import App from "./src/App";
import { registerBackgroundPushHandler } from "./src/services/push-notifications";

registerBackgroundPushHandler();

registerRootComponent(App);
