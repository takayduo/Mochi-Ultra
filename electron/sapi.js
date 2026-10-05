// Fast out-of-process Windows SAPI speech synthesis for Mochi
var v = new ActiveXObject("SAPI.SpVoice");
for (var i = 0; i < v.GetVoices().Count; i++) {
  var vc = v.GetVoices().Item(i);
  var desc = vc.GetDescription();
  // Prefer Microsoft Zira (female assistant voice)
  if (desc.indexOf("Zira") >= 0) {
    v.Voice = vc;
    break;
  }
}
v.Rate = 1;
if (WScript.Arguments.Length > 0) {
  v.Speak(WScript.Arguments(0));
}
