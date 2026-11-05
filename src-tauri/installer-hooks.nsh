; INSIGHT NSIS installer hooks.
;
; The ~4.7 GB Llama GGUF cannot be embedded whole: makensis can't mmap a single
; file larger than ~2 GB. So scripts/prepare-bundle-windows.ps1 splits the model
; into <2 GB parts (llama-3.1-8b-instruct.gguf.000, .001, ...) which NSIS embeds
; fine. Here, after the files are laid down, we concatenate the parts back into
; the single file lib.rs expects at <install>\assets\models\ and delete the parts.
;
; Wired in via tauri.conf.json  bundle.windows.nsis.installerHooks.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Assembling the language model (one-time, this can take a minute)..."
  ; copy /b with a wildcard concatenates the parts in name order (NTFS returns
  ; directory entries sorted, and the parts are zero-padded), writing the whole
  ; GGUF. The destination name has no trailing ".NNN" so it never self-matches.
  nsExec::ExecToLog 'cmd /c copy /b /y "$INSTDIR\assets\models\llama-3.1-8b-instruct.gguf.0*" "$INSTDIR\assets\models\llama-3.1-8b-instruct.gguf"'
  Pop $0
  StrCmp $0 "0" assembled 0
    MessageBox MB_ICONSTOP "INSIGHT could not assemble its language model (error $0). The app may not start. Please reinstall, or contact support."
    Goto done
  assembled:
    ; Reclaim ~4.7 GB: the parts are no longer needed once the whole file exists.
    Delete "$INSTDIR\assets\models\llama-3.1-8b-instruct.gguf.0*"
  done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The assembled GGUF is created after install, so it is not in the uninstall
  ; log; remove it explicitly (and any leftover parts) so uninstall leaves nothing.
  Delete "$INSTDIR\assets\models\llama-3.1-8b-instruct.gguf"
  Delete "$INSTDIR\assets\models\llama-3.1-8b-instruct.gguf.0*"
!macroend
