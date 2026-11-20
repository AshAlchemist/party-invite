#!/bin/bash
# prev.sh in.png out.png — наложить PNG с альфой на молочный фон для просмотра
S=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$1")
ffmpeg -v error -y -f lavfi -i "color=c=0xECE6DA:s=$S" -i "$1" -filter_complex "[0][1]overlay=format=auto" -frames:v 1 "$2"
