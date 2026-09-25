// "Open in SumOffice" next to Excel/Word attachments. The server checks the rights again.
(function () {
  var EXT = /\.(xlsx|xlsm|xlsb|docx)$/i;
  function add() {
    var base = (document.querySelector('link[rel="stylesheet"][href*="/stylesheets/"]') || {}).href || "";
    var root = base.replace(/\/stylesheets\/.*$/, "").replace(/^https?:\/\/[^/]+/, "");
    var links = document.querySelectorAll('.attachments a[href*="/attachments/"], table.list.files a[href*="/attachments/"]');
    Array.prototype.forEach.call(links, function (a) {
      var m = a.getAttribute("href").match(/\/attachments\/(?:download\/)?(\d+)(?:\/|$)/);
      if (!m || !EXT.test(a.textContent.trim()) || a.parentNode.querySelector(".sumoffice-open[data-id='" + m[1] + "']")) return;
      var o = document.createElement("a");
      o.href = root + "/sumoffice/open/" + m[1];
      o.target = "_blank";
      o.className = "icon icon-edit sumoffice-open";
      o.setAttribute("data-id", m[1]);
      o.textContent = "Open in SumOffice";
      o.style.marginLeft = "6px";
      a.parentNode.insertBefore(o, a.nextSibling);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})();
