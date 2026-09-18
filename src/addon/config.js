const ADMIN_URL = "https://admin-panel-amber-nine.vercel.app";
const API_BASE = "https://server-nine-rosy.vercel.app/api";
const SESSION_KEY = "SDS_WORKSPACE_SESSION";
const WEB_APP_DEPLOYMENT_ID =
  "AKfycbzCvUVD8GnLvsGNpux6euGd2WJrYUmGXEE3qp-NK-emFZSFAvN5dPOkIumQLmgcm5RRVA";
const WEB_APP_URL =
  "https://script.google.com/macros/s/" + WEB_APP_DEPLOYMENT_ID + "/exec";

function onHomepage(e) {
  return buildMainCard_(e);
}

function onGmailHomepage(e) {
  return buildMainCard_(e);
}

function onGmailMessage(e) {
  return buildGmailMessageCard_(e);
}

function onGmailCompose(e) {
  return buildComposeDirectCard_(e);
}
