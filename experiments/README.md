# Experiments

`visitor-check-in.json` is the sample workflow used by CT-EXP-001, the Android Network Recovery Test.

The runner installs `com.chaostwin.demo`, starts a visit, applies emulator network delay, submits once, restores the emulator default network, and checks that exactly one visitor record exists. A missing APK, a refused fault, or a missing assertion cannot produce PASS.

On a machine without the demo APK, a running emulator, and an Appium server, the command stops before it changes a device.
