# @chaostwin/evidence

Creates `reports/<experiment-id>/` with screenshots, logs, `timeline.json`, and `metadata.json`. Opening an id that already has a directory throws, so a later run cannot replace an earlier result. A missing collector is recorded as missing evidence and does not create an empty stand-in file.
