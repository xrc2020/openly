Openly Secret Feature

Copy the src and public folders into F:\WebProj\openly, replacing matching files.
The patch is based on your supplied Openly project and previous updates.
It uses your existing public/logo.png.

After deploying, open https://playopenly.com/#Secretfeature
The hash is case-sensitive. No navigation link has been added.

Publish from PowerShell in your project folder:
npm run build
git add src/app/page.tsx src/app/components/SecretFeatureGate.tsx public/secret-feature/index.html
git commit -m "Add unlisted Openly secret feature"
git push

No SQL or dependency installation required.

The attached standalone prototype is preserved, including sample players,
controls, styles, and behavior. Only its logo has been replaced. Markdown
escaping was removed to restore valid HTML; a noindex meta tag and an isolated
frame entry point were added for website integration.

This is unlisted, not access-controlled: anyone with the link can use or share it.
The standalone HTML asset can also be accessed directly. It does not read or
write Openly games or accounts. Data resets on refresh; there is no database
persistence or sharing between devices. It retains the prototype's Tailwind CDN
and Google Fonts dependencies and its original mobile layout limitations.

Checked: TypeScript, component lint, production build, exact hash entry and exit,
logo loading, generating/ending rounds, and adding players in browser.
