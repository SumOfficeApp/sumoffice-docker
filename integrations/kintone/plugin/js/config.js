(function (PLUGIN_ID) {
  "use strict";
  var conf = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  var url = document.getElementById("sumoffice-bridge-url");
  var secret = document.getElementById("sumoffice-secret");
  url.value = conf.bridgeUrl || "";

  document.getElementById("sumoffice-save").addEventListener("click", function () {
    var bridgeUrl = url.value.trim().replace(/\/+$/, "");
    if (!/^https:\/\//.test(bridgeUrl)) { alert("The bridge URL must start with https://"); return; }
    var save = function () { kintone.plugin.app.setConfig({ bridgeUrl: bridgeUrl }); };
    if (!secret.value && conf.bridgeUrl === bridgeUrl) { save(); return; }
    if (secret.value.length < 16) { alert("The secret must be at least 16 characters."); return; }
    kintone.plugin.app.setProxyConfig(bridgeUrl + "/kintone/ticket", "POST",
      { "X-SumOffice-Secret": secret.value }, {}, save);
  });
  document.getElementById("sumoffice-cancel").addEventListener("click", function () { history.back(); });
})(kintone.$PLUGIN_ID);
