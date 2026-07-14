# Demo recording: one payment under a concurrent flood yields one grant, fully covered.
# Regenerate with: vhs assets/demo.tape (run from the repo root).

Output assets/demo.gif

Set Shell "zsh"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 14
Set Width 1240
Set Height 760
Set Padding 18
Set Margin 24
Set MarginFill "#1f1f24"
Set BorderRadius 10
Set WindowBar Colorful
# Palette copied from Ghostty's "Xcode Dark hc" theme so the demo matches the terminal.
Set Theme { "name": "Xcode Dark HC", "background": "#1f1f24", "foreground": "#ffffff", "cursor": "#ffffff", "selection": "#43454b", "black": "#43454b", "red": "#ff8a7a", "green": "#83c9bc", "yellow": "#d9c668", "blue": "#4ec4e6", "magenta": "#ff85b8", "cyan": "#cda1ff", "white": "#ffffff", "brightBlack": "#838991", "brightRed": "#ff8a7a", "brightGreen": "#b1faeb", "brightYellow": "#ffa14f", "brightBlue": "#6bdfff", "brightMagenta": "#ff85b8", "brightCyan": "#e5cfff", "brightWhite": "#ffffff" }
Set TypingSpeed 40ms

Hide
Type "setopt interactive_comments"
Enter
Type "clear"
Enter
Sleep 500ms
Show

Sleep 700ms
Type "# A concurrent flood carrying one payment. A naive server grants every one."
Enter
Type "# The guard reserves the nonce atomically, so exactly one grant gets through."
Enter
Sleep 500ms
Type "npm run example"
Sleep 300ms
Enter
Sleep 4s

Type "# And every branch of the guard is covered."
Enter
Sleep 400ms
Type "npm run test:coverage"
Sleep 300ms
Enter
Sleep 6s
