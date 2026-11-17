import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import type { ComponentType, Ref } from "react";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

interface WebViewHandle {
  injectJavaScript: (script: string) => void;
}
// The package types WebView as a plain function component; it does forward a ref.
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

export interface YouTubeEmbedProps {
  videoId: string;
  /** When false the video is paused (only one entry plays at a time). */
  active: boolean;
  onPlayingChange: (playing: boolean) => void;
}

/**
 * YouTube's own visible player (required by YouTube's terms: no audio-only
 * playback), driven through the IFrame API so we know when it's actually playing.
 */
export function YouTubeEmbed({ videoId, active, onPlayingChange }: YouTubeEmbedProps) {
  const ref = useRef<WebViewHandle>(null);
  const html = useMemo(() => playerHtml(videoId), [videoId]);

  useEffect(() => {
    if (!active) ref.current?.injectJavaScript("window.player && window.player.pauseVideo && window.player.pauseVideo(); true;");
  }, [active]);

  return (
    <View style={styles.frame}>
      <WebView
        ref={ref}
        // A real https origin gives YouTube the referrer it requires for embeds.
        source={{ html, baseUrl: "https://urexp.com" }}
        originWhitelist={["https://*"]}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        javaScriptEnabled
        style={styles.web}
        onMessage={(e: WebViewMessageEvent) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data) as { state?: number };
            if (typeof msg.state === "number") onPlayingChange(msg.state === 1);
          } catch {
            // ignore
          }
        }}
      />
    </View>
  );
}

function playerHtml(videoId: string): string {
  const id = JSON.stringify(videoId);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}#p{position:absolute;inset:0;width:100%;height:100%}</style></head>
<body><div id="p"></div>
<script>
var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);
function onYouTubeIframeAPIReady(){
  window.player=new YT.Player('p',{videoId:${id},host:'https://www.youtube-nocookie.com',
    playerVars:{playsinline:1,rel:0,modestbranding:1},
    events:{onStateChange:function(e){window.ReactNativeWebView.postMessage(JSON.stringify({state:e.data}));}}});
}
</script></body></html>`;
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 16 / 9, width: "100%", borderRadius: 10, overflow: "hidden", backgroundColor: "#000" },
  web: { flex: 1, backgroundColor: "#000" },
});
