package com.azesmwayreactnativeunity;

import static com.azesmwayreactnativeunity.ReactNativeUnity.*;

import android.content.Context;

import android.annotation.SuppressLint;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import java.lang.reflect.InvocationTargetException;

@SuppressLint("ViewConstructor")
public class ReactNativeUnityView extends FrameLayout {
  private UPlayer view;
  public boolean keepPlayerMounted = false;

  public ReactNativeUnityView(Context context) {
    super(context);
    setBackgroundColor(0x00000000);
  }

  private void applyTransparentToSurfaces(View root) {
    if (root instanceof SurfaceView) {
      SurfaceView sv = (SurfaceView) root;
      sv.setZOrderOnTop(true);
      sv.getHolder().setFormat(PixelFormat.TRANSLUCENT);
      sv.setBackgroundColor(0x00000000);
    }
    if (root instanceof ViewGroup) {
      ViewGroup vg = (ViewGroup) root;
      for (int i = 0; i < vg.getChildCount(); i++) {
        applyTransparentToSurfaces(vg.getChildAt(i));
      }
    }
  }

  @Override
  protected void onAttachedToWindow() {
    super.onAttachedToWindow();
    applyTransparentToSurfaces(this);
  }

  public void setUnityPlayer(UPlayer player) throws InvocationTargetException, NoSuchMethodException, IllegalAccessException {
    this.view = player;
    addUnityViewToGroup(this);
  }

  @Override
  public void onWindowFocusChanged(boolean hasWindowFocus) {
    super.onWindowFocusChanged(hasWindowFocus);

    if (view == null) {
      return;
    }

    view.windowFocusChanged(hasWindowFocus);

    if (!keepPlayerMounted || !_isUnityReady) {
      return;
    }

    // pause Unity on blur, resume on focus
    if (hasWindowFocus && _isUnityPaused) {
      // view.requestFocus();
      view.resume();
    } else if (!hasWindowFocus && !_isUnityPaused) {
      view.pause();
    }
  }

  @Override
  protected void onConfigurationChanged(Configuration newConfig) {
    super.onConfigurationChanged(newConfig);

    if (view != null) {
      view.configurationChanged(newConfig);
    }
  }

  @Override
  protected void onDetachedFromWindow() {
    if (!this.keepPlayerMounted) {
        try {
            addUnityViewToBackground();
        } catch (InvocationTargetException | NoSuchMethodException | IllegalAccessException e) {
            throw new RuntimeException(e);
        }
    }

    super.onDetachedFromWindow();
  }
}
