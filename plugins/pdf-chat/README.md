# PDF to chat

Read PDF files in bb, zoom, and send selected text to chat or copy it.

Links in a PDF are clickable. Web links open through bb's `useBbNavigate().openUrl`, so they follow this client's browser preference (the in-app Browser or the external one); internal links scroll to their page. Only `http:`, `https:` and `mailto:` links get a click target; annotation actions are never run.
