// SumOffice for kintone: "Open in SumOffice" next to .xlsx, .xlsm, .xlsb and .docx files
// in attachment fields of a record. The bridge (see ../bridge) serves the file to
// SumOffice over WOPI; Ctrl+S puts the new file back into the same field slot.
(function (PLUGIN_ID) {
  "use strict";
  var EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
  var conf = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  if (!conf.bridgeUrl) return;
  var ticketUrl = conf.bridgeUrl.replace(/\/+$/, "") + "/kintone/ticket";

  function ext(name) {
    var i = String(name).lastIndexOf(".");
    return i < 0 ? "" : String(name).slice(i + 1).toLowerCase();
  }

  function rights(app, id) {
    return kintone.api(kintone.api.url("/k/v1/records/acl/evaluate", true), "GET", { app: app, ids: [id] })
      .then(function (r) { return r.rights[0]; })
      .catch(function () { return null; });
  }

  function open(win, ticket) {
    var doc = win.document;
    doc.open();
    doc.write("<!doctype html><meta charset=utf-8><title>SumOffice</title><body style=margin:0></body>");
    doc.close();
    var form = doc.createElement("form");
    form.method = "post";
    form.action = ticket.action;
    [["access_token", ticket.access_token], ["access_token_ttl", String(ticket.access_token_ttl)]].forEach(function (p) {
      var input = doc.createElement("input");
      input.type = "hidden"; input.name = p[0]; input.value = p[1];
      form.appendChild(input);
    });
    doc.body.appendChild(form);
    form.submit();
  }

  function link(app, recordId, fieldCode, index, file, canWrite) {
    var a = document.createElement("a");
    a.href = "#";
    a.className = "sumoffice-open";
    a.textContent = "Open in SumOffice";
    a.style.marginLeft = "8px";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      // The window opens right away, inside the click, so the browser does not block it.
      var win = window.open("", "_blank");
      var user = kintone.getLoginUser();
      var body = { app: String(app), record: String(recordId), field: fieldCode, index: index, name: file.name,
        canWrite: canWrite, user: { code: user.code, name: user.name } };
      kintone.plugin.app.proxy(PLUGIN_ID, ticketUrl, "POST", { "Content-Type": "application/json" }, body)
        .then(function (r) {
          var status = r[1];
          var ticket = JSON.parse(r[0] || "{}");
          if (status !== 200) throw new Error(ticket.error || ("SumOffice bridge: " + status));
          open(win, ticket);
        })
        .catch(function (err) {
          if (win) win.close();
          alert(err.message || String(err));
        });
    });
    return a;
  }

  kintone.events.on("app.record.detail.show", function (event) {
    var app = kintone.app.getId();
    var recordId = event.recordId;
    var record = event.record;
    rights(app, recordId).then(function (r) {
      Object.keys(record).forEach(function (code) {
        var field = record[code];
        if (field.type !== "FILE" || !field.value || !field.value.length) return;
        var el = kintone.app.record.getFieldElement(code);
        if (!el) return;
        var canWrite = !!(r && r.record.editable && (!r.fields || !r.fields[code] || r.fields[code].editable));
        var rows = el.querySelectorAll("a");
        field.value.forEach(function (file, index) {
          if (EXTENSIONS.indexOf(ext(file.name)) < 0) return;
          var a = link(app, recordId, code, index, file, canWrite);
          var anchor = Array.prototype.filter.call(rows, function (x) { return x.textContent.indexOf(file.name) >= 0; })[0];
          if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(a, anchor.nextSibling);
          else { var div = document.createElement("div"); div.appendChild(a); el.appendChild(div); }
        });
      });
    });
    return event;
  });
})(kintone.$PLUGIN_ID);
