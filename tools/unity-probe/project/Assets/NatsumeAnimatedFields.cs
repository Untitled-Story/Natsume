using UnityEngine;
using UnityEngine.Animations;

// Controlled field types for animation format measurements, not game behavior.
public class NatsumeAnimatedFields : MonoBehaviour
{
    public enum Choice { Negative=-2, Two=2, Five=5, Unset=99 }
    public int mode;
    [DiscreteEvaluation] public int discrete;
    public Choice choice;
    public bool flag;
    public float mirror;
}
