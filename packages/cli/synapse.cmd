@echo off
:: Synapse CLI — standalone launcher
:: Place this .cmd next to the dist/ folder and run from anywhere.
:: Usage: synapse start | synapse stop | synapse status | synapse open
node "%~dp0dist\cli.mjs" %*
