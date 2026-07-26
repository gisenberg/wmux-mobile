FROM node:22.13.1-bookworm

ARG ANDROID_COMMAND_LINE_TOOLS_REVISION=15859902
ARG ANDROID_COMMAND_LINE_TOOLS_SHA256=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583
ARG ANDROID_API_LEVEL=36
ARG ANDROID_BUILD_TOOLS_VERSION=36.0.0
ARG ANDROID_NDK_VERSION=27.1.12297006
ARG ANDROID_CMAKE_VERSION=3.22.1

ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV DEBIAN_FRONTEND=noninteractive
ENV GRADLE_USER_HOME=/home/node/.gradle
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:${PATH}

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    curl \
    git \
    openjdk-17-jdk-headless \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl --fail --location --retry 3 \
    --output /tmp/android-command-line-tools.zip \
    "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_COMMAND_LINE_TOOLS_REVISION}_latest.zip" \
  && echo "${ANDROID_COMMAND_LINE_TOOLS_SHA256}  /tmp/android-command-line-tools.zip" | sha256sum --check --strict \
  && mkdir -p "${ANDROID_HOME}/cmdline-tools/latest" \
  && unzip -q /tmp/android-command-line-tools.zip -d /tmp/android-command-line-tools \
  && mv /tmp/android-command-line-tools/cmdline-tools/* "${ANDROID_HOME}/cmdline-tools/latest/" \
  && rm -rf /tmp/android-command-line-tools /tmp/android-command-line-tools.zip

RUN yes | sdkmanager --licenses >/dev/null \
  && sdkmanager \
    "build-tools;${ANDROID_BUILD_TOOLS_VERSION}" \
    "cmake;${ANDROID_CMAKE_VERSION}" \
    "ndk;${ANDROID_NDK_VERSION}" \
    "platform-tools" \
    "platforms;android-${ANDROID_API_LEVEL}" \
  && chown -R node:node "${ANDROID_HOME}" /home/node

USER node
WORKDIR /workspace
