---
name: directory-finder
description: Explain the local Finder action on Directory in BB thread Info and diagnose supported-machine limits.
---

In a thread's Info tab, click Directory to open the environment folder in Finder on the Mac that hosts the environment. Server reads the authoritative environment path and host, asks that machine for its platform (cached per host) and shows the control only when it is macOS and the environment is ready with an absolute path; Linux, Windows, a failed platform lookup, a missing path or an unready environment hide it. Host entry reports its platform and verifies macOS and directory existence, invokes /usr/bin/open -a Finder with argument array. No files are deleted or modified. A remote Directory retains BB's original copy action. The component is scoped to the Info tab's environment and checks the full title path before binding. Disable/unload restores original copy control. The native menu is not patched.
