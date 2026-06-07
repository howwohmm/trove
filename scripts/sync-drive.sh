#!/bin/bash
# auto-sync trove's kept images to the shared Google Drive folder.
cd "$HOME/projects/in-progress/trove" || exit 1
/opt/homebrew/bin/rclone copy library "trove:" \
  --drive-root-folder-id 1QW_012N5ejdafmWgfDmQIDBXdb5UzfXC \
  --transfers 8 --no-update-modtime >> /tmp/trove-drivesync.log 2>&1
