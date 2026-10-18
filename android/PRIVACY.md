# Vidown Android privacy policy

Development draft, 18 October 2026. Confirm the published app version and final distribution configuration before using this document for a store submission.

Vidown processes links, download tasks, browser sessions and media files on the device. This Android application does not provide a Vidown cloud account, advertisements, analytics service or automatic diagnostic upload. It does not send browsing history or credentials to a Vidown server.

When you open a website or extract/download its media, the app contacts that website, its media hosts and any services the page itself uses. Their own privacy practices apply. The bundled browser may retain cookies, site storage, cache and browsing state in the app's private profile. Persistent cookies follow the website's expiry. A Keystore-encrypted backup can restore ordinary temporary session cookies for at most seven days; partitioned cookies are not copied into an unpartitioned store. Clearing browser data removes that backup and invalidates discovered resources and task authorization. Signing out on a website remains subject to the website's behavior.

Downloads and task records are local. Temporary media stays in private storage. Completed files are saved using Android MediaStore or a folder you explicitly authorize through the system picker. Deleting task records does not delete completed files unless you choose that option. Deletion of system media can require system confirmation; custom-provider deletion can be permanent.

Clipboard detection is off by default. If enabled, it reads a link only while the app has focus and only fills an empty input field. Vidown does not monitor the background clipboard, request accessibility access, or request management of all files. Shared links are received only when you choose Vidown in Android's share menu.

Diagnostics are exported only through an explicit user action. The app-generated report contains application version, Android API, supported architectures and task states/counters. It excludes source URLs, titles, cookies, authorization headers, passwords and verification codes. Review files before sharing them. System crash reports or logs created outside the app may have different content.

Permissions are used for network access, user-initiated background transfers, processing notifications and operating-system-managed file grants. Browser camera, microphone, location and notification requests are not automatically granted. Third-party pages execute in the browser sandbox and cannot call the application's download or file-control interfaces.

App data is excluded from Android backup. Android app uninstall removes the private profile and private task data; exported files may remain in shared storage or the chosen document provider. Device security, exported files, a user-selected proxy and third-party sites are outside Vidown's control.

For project issues contact the repository maintainers through GitHub. Security-sensitive reports should use the repository's private vulnerability reporting channel. Do not attach account credentials, private cookies, verification codes or signed media URLs to public issues.
