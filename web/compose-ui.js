/**
 * Extension-style compose helpers: recipient chips + contacts + rich text.
 * Used by Workspace HtmlService panel (and local web/index.html).
 */
(function (g) {
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

  function normalizeEmail(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function isValidEmail(value) {
    return EMAIL_RE.test(String(value || "").trim());
  }

  function isEmptyRichText(html) {
    var text = String(html || "")
      .replace(/<br\s*\/?>/gi, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, "")
      .trim();
    return !text;
  }

  /* ── Google People contacts (via Apps Script OAuth token) ── */

  function peopleFetch(url, accessToken) {
    return fetch(url, {
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
      },
    }).then(function (res) {
      return res.text().then(function (bodyText) {
        var body = null;
        try {
          body = bodyText ? JSON.parse(bodyText) : null;
        } catch (e) {
          body = { raw: bodyText };
        }
        if (!res.ok) {
          var msg = String(
            (body && body.error && body.error.message) ||
              bodyText ||
              "HTTP " + res.status
          );
          var err = new Error(msg);
          if (
            /has not been used|is disabled|API has not been|SERVICE_DISABLED/i.test(
              msg
            )
          ) {
            err.code = "PEOPLE_API_DISABLED";
          } else if (
            res.status === 401 ||
            res.status === 403 ||
            /insufficient|ACCESS_TOKEN_SCOPE|authentication scopes/i.test(msg)
          ) {
            err.code = "CONTACTS_SCOPE_REQUIRED";
          } else {
            err.code = "PEOPLE_API_ERROR";
          }
          throw err;
        }
        return body || {};
      });
    });
  }

  function personToSuggestions(person) {
    var name =
      (person &&
        person.names &&
        person.names[0] &&
        (person.names[0].displayName || person.names[0].unstructuredName)) ||
      "";
    var emails = ((person && person.emailAddresses) || [])
      .map(function (e) {
        return String(e.value || "")
          .trim()
          .toLowerCase();
      })
      .filter(function (email) {
        return email.indexOf("@") > 0;
      });
    return emails.map(function (email) {
      return {
        email: email,
        name: name || email.split("@")[0],
      };
    });
  }

  function resultsToSuggestions(data) {
    var out = [];
    var rows = (data && data.results) || [];
    for (var i = 0; i < rows.length; i++) {
      out = out.concat(personToSuggestions(rows[i].person || rows[i]));
    }
    return out;
  }

  function dedupeByEmail(items) {
    var seen = {};
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var key = String(items[i].email || "").toLowerCase();
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(items[i]);
    }
    return out;
  }

  var warmedTokens = {};

  function ensureSearchWarmed(accessToken) {
    if (warmedTokens[accessToken]) return Promise.resolve();
    var mask = encodeURIComponent("names,emailAddresses");
    return Promise.allSettled([
      peopleFetch(
        "https://people.googleapis.com/v1/people:searchContacts?query=&readMask=" +
          mask +
          "&pageSize=1",
        accessToken
      ),
      peopleFetch(
        "https://people.googleapis.com/v1/otherContacts:search?query=&readMask=" +
          mask +
          "&pageSize=1",
        accessToken
      ),
    ]).then(function () {
      warmedTokens[accessToken] = true;
    });
  }

  function searchGoogleContactEmails(accessToken, query) {
    var q = String(query || "").trim();
    if (!accessToken || !q) return Promise.resolve([]);
    var mask = encodeURIComponent("names,emailAddresses");
    var encoded = encodeURIComponent(q);
    return ensureSearchWarmed(accessToken).then(function () {
      var results = [];
      var errors = [];
      return Promise.allSettled([
        peopleFetch(
          "https://people.googleapis.com/v1/people:searchContacts?query=" +
            encoded +
            "&readMask=" +
            mask +
            "&pageSize=30",
          accessToken
        ).then(function (data) {
          results = results.concat(resultsToSuggestions(data));
        }),
        peopleFetch(
          "https://people.googleapis.com/v1/otherContacts:search?query=" +
            encoded +
            "&readMask=" +
            mask +
            "&pageSize=30",
          accessToken
        ).then(function (data) {
          results = results.concat(resultsToSuggestions(data));
        }),
      ]).then(function (settled) {
        for (var i = 0; i < settled.length; i++) {
          if (settled[i].status === "rejected") errors.push(settled[i].reason);
        }
        if (!results.length && errors.length) {
          var disabled = errors.filter(function (e) {
            return e && e.code === "PEOPLE_API_DISABLED";
          })[0];
          var scopeErr = errors.filter(function (e) {
            return e && e.code === "CONTACTS_SCOPE_REQUIRED";
          })[0];
          throw disabled || scopeErr || errors[0];
        }
        return dedupeByEmail(results);
      });
    });
  }

  function getAppsScriptOAuthToken() {
    return new Promise(function (resolve, reject) {
      try {
        if (
          typeof google === "undefined" ||
          !google.script ||
          !google.script.run
        ) {
          reject(new Error("Apps Script bridge unavailable"));
          return;
        }
        google.script.run
          .withSuccessHandler(function (token) {
            if (token) resolve(String(token));
            else reject(new Error("Empty OAuth token"));
          })
          .withFailureHandler(function (err) {
            reject(err || new Error("Could not get OAuth token"));
          })
          .getWorkspaceOAuthToken();
      } catch (e) {
        reject(e);
      }
    });
  }

  function searchContactsViaAppsScript(query) {
    return new Promise(function (resolve, reject) {
      try {
        if (
          typeof google === "undefined" ||
          !google.script ||
          !google.script.run
        ) {
          reject(new Error("Apps Script bridge unavailable"));
          return;
        }
        google.script.run
          .withSuccessHandler(function (out) {
            if (out && out.ok === false) {
              var err = new Error(out.error || "Contacts search failed");
              err.code = out.code || "CONTACTS_SEARCH_FAILED";
              reject(err);
              return;
            }
            resolve((out && out.results) || []);
          })
          .withFailureHandler(function (err) {
            reject(err || new Error("Contacts search failed"));
          })
          .searchWorkspaceContacts(String(query || ""));
      } catch (e) {
        reject(e);
      }
    });
  }

  function searchContactEmails(query) {
    return searchContactsViaAppsScript(query).catch(function () {
      return getAppsScriptOAuthToken().then(function (token) {
        return searchGoogleContactEmails(token, query);
      });
    });
  }

  /* ── Recipient chip field ── */

  function createRecipientInput(rootEl, options) {
    options = options || {};
    var emails = [];
    var query = "";
    var suggestions = [];
    var open = false;
    var loading = false;
    var hint = "";
    var needsContacts = false;
    var activeIndex = -1;
    var reqId = 0;
    var disabled = false;
    var onChange = typeof options.onChange === "function" ? options.onChange : null;
    var placeholder =
      options.placeholder || "Type email, pick suggestion or Add…";

    rootEl.className =
      (rootEl.className ? rootEl.className + " " : "") + "recipient-suggest";
    rootEl.innerHTML =
      '<div class="recipient-chip-field" id="recipient-chip-field">' +
      '<input class="recipient-chip-input" id="recipient-chip-input" autocomplete="off" />' +
      "</div>" +
      '<p class="recipient-suggest-status" id="recipient-suggest-status" style="display:none"></p>' +
      '<button type="button" class="btn btn-secondary" id="btn-allow-contacts" style="display:none;margin-top:8px;margin-bottom:4px">Allow Google Contacts</button>' +
      '<ul class="recipient-suggest-list" id="recipient-suggest-list" role="listbox" style="display:none"></ul>';

    var field = rootEl.querySelector("#recipient-chip-field");
    var input = rootEl.querySelector("#recipient-chip-input");
    var statusEl = rootEl.querySelector("#recipient-suggest-status");
    var allowBtn = rootEl.querySelector("#btn-allow-contacts");
    var listEl = rootEl.querySelector("#recipient-suggest-list");

    function selectedSet() {
      var set = {};
      for (var i = 0; i < emails.length; i++) {
        set[normalizeEmail(emails[i])] = true;
      }
      return set;
    }

    function emit() {
      if (onChange) onChange(emails.slice());
    }

    function renderChips() {
      var nodes = field.querySelectorAll(".recipient-chip");
      for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.removeChild(nodes[i]);
      for (var j = 0; j < emails.length; j++) {
        (function (email) {
          var chip = document.createElement("span");
          chip.className = "recipient-chip";
          chip.innerHTML =
            '<span class="recipient-chip-text"></span>' +
            '<button type="button" class="recipient-chip-remove" aria-label="Remove">×</button>';
          chip.querySelector(".recipient-chip-text").textContent = email;
          chip.querySelector(".recipient-chip-remove").disabled = disabled;
          chip
            .querySelector(".recipient-chip-remove")
            .addEventListener("click", function (e) {
              e.stopPropagation();
              removeEmail(email);
            });
          field.insertBefore(chip, input);
        })(emails[j]);
      }
      input.placeholder = emails.length ? "" : placeholder;
      input.disabled = disabled;
      if (disabled) field.classList.add("is-disabled");
      else field.classList.remove("is-disabled");
    }

    function setStatus() {
      if (loading) {
        statusEl.style.display = "block";
        statusEl.textContent = "Searching contact emails…";
      } else if (hint) {
        statusEl.style.display = "block";
        statusEl.textContent = hint;
      } else {
        statusEl.style.display = "none";
        statusEl.textContent = "";
      }
      allowBtn.style.display = needsContacts ? "block" : "none";
    }

    function buildMenu(q, contactRows) {
      var typed = String(q || "").trim();
      var set = selectedSet();
      var rows = (contactRows || []).filter(function (item) {
        return !set[normalizeEmail(item.email)];
      });
      var typedNorm = typed ? normalizeEmail(typed) : "";
      var typedAlready = typedNorm && set[typedNorm];
      var typedInSuggestions = rows.some(function (r) {
        return normalizeEmail(r.email) === typedNorm;
      });

      if (typed && isValidEmail(typed) && !typedAlready && !typedInSuggestions) {
        rows.unshift({
          email: typedNorm,
          name: "Use this email",
          isCustom: true,
        });
      } else if (typed.length >= 2 && !rows.length && !typedAlready) {
        rows.push({
          email: typed,
          name: isValidEmail(typed)
            ? "Use this email"
            : "Keep typing a valid email…",
          isCustom: true,
          disabled: !isValidEmail(typed),
        });
      }
      return rows;
    }

    function renderSuggestions() {
      listEl.innerHTML = "";
      if (!open || !suggestions.length) {
        listEl.style.display = "none";
        return;
      }
      listEl.style.display = "block";
      for (var i = 0; i < suggestions.length; i++) {
        (function (item, index) {
          var li = document.createElement("li");
          var btn = document.createElement("button");
          btn.type = "button";
          btn.role = "option";
          btn.disabled = Boolean(item.disabled);
          btn.className =
            "recipient-suggest-item" +
            (index === activeIndex ? " is-active" : "");
          btn.innerHTML =
            '<span class="recipient-suggest-name"></span>' +
            '<span class="recipient-suggest-email"></span>';
          btn.querySelector(".recipient-suggest-name").textContent =
            item.name || "";
          var emailLabel =
            item.isCustom && isValidEmail(item.email)
              ? 'Add “‘ + item.email + '”'
              : item.email;
          btn.querySelector(".recipient-suggest-email").textContent = emailLabel;
          btn.addEventListener("mousedown", function (e) {
            e.preventDefault();
          });
          btn.addEventListener("mouseenter", function () {
            activeIndex = index;
            renderSuggestions();
          });
          btn.addEventListener("click", function () {
            pickSuggestion(item);
          });
          li.appendChild(btn);
          listEl.appendChild(li);
        })(suggestions[i], i);
      }
    }

    function addEmail(raw) {
      var email = normalizeEmail(String(raw || "").trim());
      if (!isValidEmail(email)) {
        hint = "Enter a valid email address.";
        setStatus();
        return;
      }
      if (selectedSet()[email]) {
        hint = "That email is already added.";
        query = "";
        input.value = "";
        suggestions = [];
        open = false;
        setStatus();
        renderSuggestions();
        return;
      }
      emails.push(email);
      query = "";
      input.value = "";
      suggestions = [];
      open = false;
      activeIndex = -1;
      hint = "";
      renderChips();
      setStatus();
      renderSuggestions();
      emit();
      setTimeout(function () {
        input.focus();
      }, 0);
    }

    function removeEmail(email) {
      var target = normalizeEmail(email);
      emails = emails.filter(function (e) {
        return normalizeEmail(e) !== target;
      });
      renderChips();
      emit();
    }

    function pickSuggestion(item) {
      if (item && item.disabled) return;
      addEmail(item.email);
    }

    function runSearch() {
      var q = String(query || "").trim();
      if (disabled || q.length < 2) {
        suggestions = [];
        open = false;
        loading = false;
        activeIndex = -1;
        setStatus();
        renderSuggestions();
        return;
      }
      var id = ++reqId;
      loading = true;
      hint = "";
      setStatus();
      setTimeout(function () {
        if (reqId !== id) return;
        searchContactEmails(q)
          .then(function (matches) {
            if (reqId !== id) return;
            suggestions = buildMenu(q, matches);
            open = suggestions.length > 0;
            activeIndex = suggestions.length ? 0 : -1;
            needsContacts = false;
            loading = false;
            setStatus();
            renderSuggestions();
          })
          .catch(function (err) {
            if (reqId !== id) return;
            suggestions = buildMenu(q, []);
            open = suggestions.length > 0;
            activeIndex = suggestions.length ? 0 : -1;
            loading = false;
            if (
              err &&
              (err.code === "CONTACTS_SCOPE_REQUIRED" ||
                err.code === "PEOPLE_API_DISABLED")
            ) {
              needsContacts = true;
              hint = err.message || "Google Contacts permission needed.";
            }
            setStatus();
            renderSuggestions();
          });
      }, 250);
    }

    field.addEventListener("click", function () {
      input.focus();
    });

    input.addEventListener("input", function () {
      query = String(input.value || "").replace(/,/g, "");
      input.value = query;
      runSearch();
    });

    input.addEventListener("focus", function () {
      if (suggestions.length) {
        open = true;
        renderSuggestions();
      }
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !query && emails.length) {
        removeEmail(emails[emails.length - 1]);
        return;
      }
      if (e.key === "Escape") {
        open = false;
        renderSuggestions();
        return;
      }
      if (e.key === "ArrowDown" && open && suggestions.length) {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % suggestions.length;
        renderSuggestions();
        return;
      }
      if (e.key === "ArrowUp" && open && suggestions.length) {
        e.preventDefault();
        activeIndex =
          activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1;
        renderSuggestions();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
        if (
          open &&
          activeIndex >= 0 &&
          suggestions[activeIndex] &&
          !suggestions[activeIndex].disabled
        ) {
          e.preventDefault();
          pickSuggestion(suggestions[activeIndex]);
          return;
        }
        if (query.trim()) {
          e.preventDefault();
          addEmail(query);
        }
      }
    });

    allowBtn.addEventListener("click", function () {
      loading = true;
      hint = "Waiting for Google permission…";
      setStatus();
      // Re-authorize by calling server helper that may prompt for new scopes.
      searchContactsViaAppsScript(query || "a")
        .then(function (matches) {
          needsContacts = false;
          hint = "";
          loading = false;
          if (String(query || "").trim().length >= 2) {
            suggestions = buildMenu(query, matches);
            open = suggestions.length > 0;
          }
          setStatus();
          renderSuggestions();
        })
        .catch(function (err) {
          needsContacts = true;
          loading = false;
          hint = (err && err.message) || "Could not connect Google Contacts.";
          setStatus();
        });
    });

    document.addEventListener("mousedown", function (e) {
      if (!rootEl.contains(e.target)) {
        open = false;
        renderSuggestions();
      }
    });

    renderChips();
    setStatus();

    return {
      getEmails: function () {
        return emails.slice();
      },
      setEmails: function (list) {
        emails = (list || []).map(normalizeEmail).filter(isValidEmail);
        renderChips();
        emit();
      },
      clear: function () {
        emails = [];
        query = "";
        input.value = "";
        suggestions = [];
        open = false;
        renderChips();
        setStatus();
        renderSuggestions();
        emit();
      },
      setDisabled: function (value) {
        disabled = Boolean(value);
        renderChips();
      },
    };
  }

  /* ── Rich text editor (contenteditable; Quill-compatible HTML) ── */

  function createRichTextEditor(rootEl, options) {
    options = options || {};
    var placeholder = options.placeholder || "Message (encrypted as rich text)";
    var disabled = false;
    var onChange =
      typeof options.onChange === "function" ? options.onChange : null;

    rootEl.className =
      (rootEl.className ? rootEl.className + " " : "") + "rich-editor";
    rootEl.innerHTML =
      '<div class="rte-toolbar" role="toolbar">' +
      '<button type="button" data-cmd="bold" title="Bold"><b>B</b></button>' +
      '<button type="button" data-cmd="italic" title="Italic"><i>I</i></button>' +
      '<button type="button" data-cmd="underline" title="Underline"><u>U</u></button>' +
      '<button type="button" data-cmd="strikeThrough" title="Strike"><s>S</s></button>' +
      '<span class="rte-sep"></span>' +
      '<button type="button" data-cmd="insertUnorderedList" title="Bullet list">• List</button>' +
      '<button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>' +
      '<span class="rte-sep"></span>' +
      '<button type="button" data-cmd="formatBlock" data-value="h2" title="Heading">H</button>' +
      '<button type="button" data-cmd="createLink" title="Link">Link</button>' +
      '<button type="button" data-cmd="removeFormat" title="Clear">Clear</button>' +
      "</div>" +
      '<div class="rte-editor ql-editor" contenteditable="true" data-placeholder="' +
      String(placeholder).replace(/"/g, "&quot;") +
      '"></div>';

    var toolbar = rootEl.querySelector(".rte-toolbar");
    var editor = rootEl.querySelector(".rte-editor");

    function emit() {
      if (onChange) onChange(editor.innerHTML);
    }

    function updateEmptyClass() {
      if (isEmptyRichText(editor.innerHTML)) {
        editor.classList.add("is-empty");
      } else {
        editor.classList.remove("is-empty");
      }
    }

    toolbar.addEventListener("mousedown", function (e) {
      e.preventDefault();
    });

    toolbar.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-cmd]");
      if (!btn || disabled) return;
      var cmd = btn.getAttribute("data-cmd");
      var value = btn.getAttribute("data-value") || null;
      editor.focus();
      if (cmd === "createLink") {
        var url = window.prompt("Link URL", "https://");
        if (!url) return;
        document.execCommand("createLink", false, url);
      } else if (cmd === "formatBlock") {
        document.execCommand("formatBlock", false, value || "p");
      } else {
        document.execCommand(cmd, false, value);
      }
      emit();
      updateEmptyClass();
    });

    editor.addEventListener("input", function () {
      emit();
      updateEmptyClass();
    });

    editor.addEventListener("blur", function () {
      emit();
      updateEmptyClass();
    });

    updateEmptyClass();

    return {
      getHtml: function () {
        return editor.innerHTML;
      },
      setHtml: function (html) {
        editor.innerHTML = html || "";
        updateEmptyClass();
        emit();
      },
      clear: function () {
        editor.innerHTML = "";
        updateEmptyClass();
        emit();
      },
      setDisabled: function (value) {
        disabled = Boolean(value);
        editor.contentEditable = disabled ? "false" : "true";
        if (disabled) rootEl.classList.add("is-disabled");
        else rootEl.classList.remove("is-disabled");
      },
    };
  }

  g.isValidEmail = isValidEmail;
  g.normalizeEmail = normalizeEmail;
  g.isEmptyRichText = isEmptyRichText;
  g.searchGoogleContactEmails = searchGoogleContactEmails;
  g.searchContactEmails = searchContactEmails;
  g.createRecipientInput = createRecipientInput;
  g.createRichTextEditor = createRichTextEditor;
})(typeof globalThis !== "undefined" ? globalThis : window);
