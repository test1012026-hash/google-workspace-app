/** Exposed to HtmlService: return current user's OAuth token for People API. */
function getWorkspaceOAuthToken() {
  return ScriptApp.getOAuthToken();
}

/**
 * Search Contacts + Other contacts (same endpoints as Chrome extension).
 * @param {string} query
 * @returns {{ok:boolean, results:Array<{email:string,name:string}>, error?:string, code?:string}}
 */
function searchWorkspaceContacts(query) {
  try {
    return searchWorkspaceContacts_(String(query || ""));
  } catch (err) {
    return {
      ok: false,
      results: [],
      error: String(err && err.message ? err.message : err),
      code: "CONTACTS_SEARCH_FAILED",
    };
  }
}

function searchWorkspaceContacts_(query) {
  var q = String(query || "").trim();
  if (q.length < 2) {
    return { ok: true, results: [] };
  }

  var token = ScriptApp.getOAuthToken();
  var mask = "names,emailAddresses";
  var encoded = encodeURIComponent(q);
  var maskEnc = encodeURIComponent(mask);

  // Warmup (Google requires empty query once per session for freshness).
  try {
    UrlFetchApp.fetch(
      "https://people.googleapis.com/v1/people:searchContacts?query=&readMask=" +
        maskEnc +
        "&pageSize=1",
      {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true,
      }
    );
    UrlFetchApp.fetch(
      "https://people.googleapis.com/v1/otherContacts:search?query=&readMask=" +
        maskEnc +
        "&pageSize=1",
      {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true,
      }
    );
  } catch (eWarm) {}

  var urls = [
    "https://people.googleapis.com/v1/people:searchContacts?query=" +
      encoded +
      "&readMask=" +
      maskEnc +
      "&pageSize=30",
    "https://people.googleapis.com/v1/otherContacts:search?query=" +
      encoded +
      "&readMask=" +
      maskEnc +
      "&pageSize=30",
  ];

  var results = [];
  var lastError = null;
  var scopeError = false;
  var disabledError = false;

  for (var i = 0; i < urls.length; i++) {
    var res = UrlFetchApp.fetch(urls[i], {
      method: "get",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var text = res.getContentText() || "";
    var data = {};
    try {
      data = JSON.parse(text || "{}");
    } catch (eParse) {}

    if (code < 200 || code >= 300) {
      var msg = String(
        (data.error && data.error.message) || text || "HTTP " + code
      );
      lastError = msg;
      if (
        /has not been used|is disabled|API has not been|SERVICE_DISABLED/i.test(
          msg
        )
      ) {
        disabledError = true;
      }
      if (
        code === 401 ||
        code === 403 ||
        /insufficient|ACCESS_TOKEN_SCOPE|authentication scopes/i.test(msg)
      ) {
        scopeError = true;
      }
      continue;
    }

    var rows = data.results || [];
    for (var r = 0; r < rows.length; r++) {
      var person = rows[r].person || rows[r] || {};
      var name =
        (person.names &&
          person.names[0] &&
          (person.names[0].displayName ||
            person.names[0].unstructuredName)) ||
        "";
      var emails = person.emailAddresses || [];
      for (var e = 0; e < emails.length; e++) {
        var email = String(emails[e].value || "")
          .trim()
          .toLowerCase();
        if (email.indexOf("@") < 0) continue;
        results.push({
          email: email,
          name: name || email.split("@")[0],
        });
      }
    }
  }

  var deduped = [];
  var seen = {};
  for (var d = 0; d < results.length; d++) {
    var key = results[d].email;
    if (seen[key]) continue;
    seen[key] = true;
    deduped.push(results[d]);
  }

  if (!deduped.length && lastError) {
    if (disabledError) {
      return {
        ok: false,
        results: [],
        error:
          "People API is disabled. Enable “People API” in Google Cloud Console, then try again.",
        code: "PEOPLE_API_DISABLED",
      };
    }
    if (scopeError) {
      return {
        ok: false,
        results: [],
        error:
          "Google Contacts permission missing. Re-authorize the Workspace app and allow Contacts access.",
        code: "CONTACTS_SCOPE_REQUIRED",
      };
    }
    return {
      ok: false,
      results: [],
      error: lastError,
      code: "PEOPLE_API_ERROR",
    };
  }

  return { ok: true, results: deduped };
}
