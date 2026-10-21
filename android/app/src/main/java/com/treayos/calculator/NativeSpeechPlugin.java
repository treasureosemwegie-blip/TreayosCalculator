package com.treayos.calculator;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "NativeSpeech")
public class NativeSpeechPlugin extends Plugin {

    private TextToSpeech tts;
    private boolean ready = false;
    private boolean failed = false;
    private boolean destroyed = false;
    private PluginCall pendingCall;
    private String pendingText;
    private float pendingRate = 1.1f;
    private float pendingPitch = 1.0f;

    @Override
    public void load() {
        try {
            tts = new TextToSpeech(getContext(), status -> {
                if (destroyed) {
                    return;
                }

                if (status != TextToSpeech.SUCCESS) {
                    failed = true;
                    failPending("Text-to-speech is not available on this device.");
                    return;
                }

                int languageStatus = tts.setLanguage(Locale.US);
                if (
                    languageStatus == TextToSpeech.LANG_MISSING_DATA ||
                    languageStatus == TextToSpeech.LANG_NOT_SUPPORTED
                ) {
                    languageStatus = tts.setLanguage(Locale.getDefault());
                }

                if (
                    languageStatus == TextToSpeech.LANG_MISSING_DATA ||
                    languageStatus == TextToSpeech.LANG_NOT_SUPPORTED
                ) {
                    failed = true;
                    failPending("No English text-to-speech voice is installed.");
                    return;
                }

                ready = true;

                if (pendingText != null) {
                    String text = pendingText;
                    float rate = pendingRate;
                    float pitch = pendingPitch;
                    PluginCall call = pendingCall;

                    pendingText = null;
                    pendingCall = null;

                    speakNow(text, rate, pitch);
                    if (call != null) {
                        call.resolve();
                    }
                }
            });
        } catch (Exception error) {
            failed = true;
            failPending("Text-to-speech could not be started.");
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("No text to speak.");
            return;
        }

        float rate = clamp(call.getFloat("rate", 1.1f), 0.5f, 2.0f);
        float pitch = clamp(call.getFloat("pitch", 1.0f), 0.5f, 2.0f);

        if (failed) {
            call.reject("Text-to-speech is not available on this device.");
            return;
        }

        if (!ready) {
            if (pendingCall != null) {
                pendingCall.resolve();
            }

            pendingCall = call;
            pendingText = text;
            pendingRate = rate;
            pendingPitch = pitch;
            return;
        }

        speakNow(text, rate, pitch);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        pendingText = null;

        if (pendingCall != null) {
            pendingCall.resolve();
            pendingCall = null;
        }

        if (tts != null) {
            tts.stop();
        }

        call.resolve();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", ready);
        result.put("failed", failed);
        call.resolve(result);
    }

    private void speakNow(String text, float rate, float pitch) {
        if (tts == null) {
            return;
        }

        tts.setSpeechRate(rate);
        tts.setPitch(pitch);

        int maxLength = Math.max(400, TextToSpeech.getMaxSpeechInputLength() - 100);
        List<String> chunks = splitText(text, maxLength);

        for (int i = 0; i < chunks.size(); i += 1) {
            int queueMode = i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
            tts.speak(chunks.get(i), queueMode, new Bundle(), "treayos-" + System.nanoTime() + "-" + i);
        }
    }

    private List<String> splitText(String text, int maxLength) {
        List<String> chunks = new ArrayList<>();
        String remaining = text.trim();

        while (remaining.length() > maxLength) {
            int splitAt = remaining.lastIndexOf(' ', maxLength);
            if (splitAt < maxLength / 2) {
                splitAt = maxLength;
            }

            chunks.add(remaining.substring(0, splitAt).trim());
            remaining = remaining.substring(splitAt).trim();
        }

        if (!remaining.isEmpty()) {
            chunks.add(remaining);
        }

        return chunks;
    }

    private void failPending(String message) {
        if (pendingCall != null) {
            pendingCall.reject(message);
            pendingCall = null;
        }
        pendingText = null;
    }

    private float clamp(Float value, float min, float max) {
        float result = value == null ? 1.0f : value;
        return Math.max(min, Math.min(max, result));
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        ready = false;

        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
    }
}
