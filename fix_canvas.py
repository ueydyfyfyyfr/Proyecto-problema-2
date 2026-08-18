import sys
content = open('index.html', 'r', encoding='utf-8').read()
content = content.replace('<canvas id="chart-', '<div style="width:100%; height:100%;" id="chart-')
content = content.replace('</canvas>', '</div>')
open('index.html', 'w', encoding='utf-8').write(content)
