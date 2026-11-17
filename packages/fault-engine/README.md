# @chaostwin/fault-engine

Schedules emulator faults through an injected command runner. Supported faults are network delay, network speed, GSM data off, home-and-resume, and force-stop of a `com.chaostwin.*` activity. Packet loss has no command. Restore targets are the emulator defaults: delay `none`, speed `full`, and GSM data `on`. A profile that was already active is not measured.
