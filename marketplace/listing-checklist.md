# Marketplace private listing checklist (development)

Use with the Apps Script add-on in the parent folder.

## Before you start

- [ ] Workspace admin or developer account (`@yourdomain.com`)
- [ ] Add-on works in Gmail via **Test deployments**
- [ ] Public HTTPS logo (128×128 or larger)
- [ ] 1–2 screenshots of the add-on card
- [ ] Support email on your domain
- [ ] Privacy / Terms URL (example: https://admin-panel-amber-nine.vercel.app/terms)

## Cloud + SDK

- [ ] GCP project created: https://console.cloud.google.com
- [ ] Marketplace SDK enabled: https://console.cloud.google.com/apis/library/appsmarket-component.googleapis.com
- [ ] Apps Script linked to that GCP project
- [ ] Marketplace SDK → App Configuration completed  
      Docs: https://developers.google.com/workspace/marketplace/enable-configure-sdk
- [ ] Visibility = **Private**
- [ ] Integration = **Google Workspace Add-on** + deployment ID
- [ ] Store Listing saved
- [ ] Publish clicked

## After publish

- [ ] Open listing as a user in your org
- [ ] Install add-on
- [ ] Confirm Gmail side panel shows **SecureDocShare** with logo
- [ ] Logo URL live: https://admin-panel-amber-nine.vercel.app/securedoc/icon-128.png
- [ ] Admin install for OU (optional): https://admin.google.com → Apps → Google Workspace Marketplace apps

## Official docs

- https://developers.google.com/workspace/marketplace/how-to-publish
- https://developers.google.com/workspace/marketplace/overview
- https://developers.google.com/apps-script/add-ons/how-tos/testing-workspace-addons
