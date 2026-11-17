# Demo Android application

ChaosTwin installs and drives only this package. The screen contract is fixed so the visitor workflow and the recovery check can stay deterministic.

| Item | Value |
| --- | --- |
| Package | `com.chaostwin.demo` |
| Activity | `com.chaostwin.demo.MainActivity` |
| Name field | `id:visitor_name` |
| Start | `id:start_visit` |
| Submit | `id:submit_visit` |
| Status | `id:visit_status`, text `Checked in` |
| Records | `GET http://127.0.0.1:8080/visitors` |

The records response is `{ "visitors": [{ "id": "v1", "name": "Test Visitor", "status": "Checked in" }] }`. Verification only reads that endpoint. It does not submit a second visit.

No APK is compiled in this repository. `npm run experiment` refuses to open a session when `--apk` does not point at a real file. Install and uninstall are limited to `com.chaostwin.*`, and uninstall runs only when the command is passed `--uninstall`.
