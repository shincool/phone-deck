' Runs Phone Deck in the background with no window (used by Windows autostart).
' Output is written to deck.log in this folder.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c node server.js > deck.log 2>&1", 0, False
