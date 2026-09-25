{{- define "sumoffice.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "sumoffice.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "sumoffice.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "sumoffice.labels" -}}
helm.sh/chart: {{ include "sumoffice.chart" . }}
app.kubernetes.io/name: {{ include "sumoffice.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: sumoffice
{{- end }}

{{/* Selector labels for one component: include "sumoffice.selectorLabels" (list . "sumsheet") */}}
{{- define "sumoffice.selectorLabels" -}}
{{- $ctx := index . 0 -}}
app.kubernetes.io/name: {{ include "sumoffice.name" $ctx }}
app.kubernetes.io/instance: {{ $ctx.Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end }}

{{- define "sumoffice.publicUrl" -}}
{{- required "publicUrl is required (e.g. https://office.example.com)" .Values.publicUrl | trimSuffix "/" }}
{{- end }}

{{- define "sumoffice.wopiUrl" -}}
{{- required "wopiHost.url is required (e.g. https://cloud.example.com)" .Values.wopiHost.url | trimSuffix "/" }}
{{- end }}

{{- define "sumoffice.wopiHostName" -}}
{{- if .Values.wopiHost.host }}
{{- .Values.wopiHost.host }}
{{- else }}
{{- (urlParse (include "sumoffice.wopiUrl" .)).host }}
{{- end }}
{{- end }}

{{- define "sumoffice.proofSecretName" -}}
{{- if .Values.proofKey.existingSecret }}
{{- .Values.proofKey.existingSecret }}
{{- else }}
{{- printf "%s-proof-key" (include "sumoffice.fullname" .) }}
{{- end }}
{{- end }}

{{- define "sumoffice.image" -}}
{{- printf "%s:%s" .repository (toString .tag) }}
{{- end }}
