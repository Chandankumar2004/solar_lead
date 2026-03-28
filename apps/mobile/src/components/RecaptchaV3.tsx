import React, { useEffect, useMemo } from "react";
import { NativeModules, View } from "react-native";
import type { WebViewMessageEvent, WebViewProps } from "react-native-webview";

type RecaptchaV3Props = {
  siteKey: string;
  action: string;
  requestId: number;
  onToken: (token: string | null) => void;
  onError: (message: string) => void;
};

type WebViewComponentType = React.ComponentType<WebViewProps>;

export function RecaptchaV3({
  siteKey,
  action,
  requestId,
  onToken,
  onError
}: RecaptchaV3Props) {
  const WebViewComponent = useMemo(() => {
    if (!NativeModules?.RNCWebViewModule) {
      return null;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const moduleValue = require("react-native-webview") as {
        WebView?: WebViewComponentType;
      };
      return moduleValue.WebView ?? null;
    } catch {
      return null;
    }
  }, [requestId]);

  useEffect(() => {
    if (!WebViewComponent) {
      onError("reCAPTCHA requires a native dev build. Open the app in development build, not Expo Go.");
    }
  }, [WebViewComponent, onError, requestId]);

  if (!WebViewComponent) {
    return null;
  }

  const html = useMemo(
    () => `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script src="https://www.google.com/recaptcha/api.js?render=${siteKey}"></script>
  </head>
  <body>
    <script>
      function send(type, payload) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload }));
      }
      function executeRecaptcha() {
        if (!window.grecaptcha || !window.grecaptcha.execute) {
          setTimeout(executeRecaptcha, 150);
          return;
        }
        window.grecaptcha.ready(function () {
          window.grecaptcha.execute("${siteKey}", { action: "${action}" })
            .then(function (token) { send("token", token); })
            .catch(function (err) { send("error", String(err)); });
        });
      }
      executeRecaptcha();
    </script>
  </body>
</html>`,
    [siteKey, action, requestId]
  );

  return (
    <View style={{ width: 0, height: 0, opacity: 0 }}>
      <WebViewComponent
        key={requestId}
        originWhitelist={["*"]}
        javaScriptEnabled
        source={{ html }}
        onMessage={(event: WebViewMessageEvent) => {
          try {
            const data = JSON.parse(event.nativeEvent.data || "{}") as {
              type?: string;
              payload?: string;
            };
            if (data.type === "token") {
              onToken(typeof data.payload === "string" ? data.payload : null);
            } else {
              onError(typeof data.payload === "string" ? data.payload : "reCAPTCHA failed");
            }
          } catch {
            onError("reCAPTCHA response could not be parsed.");
          }
        }}
        onError={() => onError("reCAPTCHA webview failed to load.")}
      />
    </View>
  );
}
